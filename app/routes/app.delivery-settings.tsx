import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { parseCsv } from "../utils/csv.server";
import { validateIndianPincode } from "../utils/delivery.server";

type ActionData = {
  ok: boolean;
  message: string;
};

function parseBool(value: FormDataEntryValue | null): boolean {
  const normalized = String(value ?? "").toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "on";
}

function normalizeHolidayList(csv: string): string {
  const values = csv
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));

  return [...new Set(values)].join(",");
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const setting =
    (await prisma.deliverySetting.findUnique({ where: { shop } })) ??
    (await prisma.deliverySetting.findUnique({ where: { shop: "default" } }));

  const rows = await prisma.pincode.findMany({
    orderBy: { pincode: "asc" },
    take: 150,
  });

  return {
    shop,
    setting: setting ?? {
      cutoffHour24: 14,
      holidaysCsv: "",
      courierEnabled: false,
      dbFallbackEnabled: true,
      weekendDaysCsv: "0",
      courierTimeoutMs: 2000,
      retryCount: 1,
    },
    samplePincodes: rows,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "save_settings") {
    const cutoffHour24 = Math.max(0, Math.min(23, Number(formData.get("cutoffHour24") ?? 14)));
    const courierEnabled = parseBool(formData.get("courierEnabled"));
    const dbFallbackEnabled = parseBool(formData.get("dbFallbackEnabled"));
    const weekendDaysCsv = String(formData.get("weekendDaysCsv") ?? "0").trim() || "0";
    const courierTimeoutMs = Math.max(500, Number(formData.get("courierTimeoutMs") ?? 2000));
    const retryCount = Math.max(0, Math.min(3, Number(formData.get("retryCount") ?? 1)));
    const holidaysCsv = normalizeHolidayList(String(formData.get("holidaysCsv") ?? ""));

    await prisma.deliverySetting.upsert({
      where: { shop },
      create: {
        shop,
        cutoffHour24,
        courierEnabled,
        dbFallbackEnabled,
        weekendDaysCsv,
        courierTimeoutMs,
        retryCount,
        holidaysCsv,
      },
      update: {
        cutoffHour24,
        courierEnabled,
        dbFallbackEnabled,
        weekendDaysCsv,
        courierTimeoutMs,
        retryCount,
        holidaysCsv,
      },
    });

    return { ok: true, message: "Settings saved." } satisfies ActionData;
  }

  if (intent === "add_holiday") {
    const holiday = String(formData.get("holidayDate") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holiday)) {
      return { ok: false, message: "Use holiday date format YYYY-MM-DD." } satisfies ActionData;
    }

    const setting =
      (await prisma.deliverySetting.findUnique({ where: { shop } })) ??
      (await prisma.deliverySetting.upsert({
        where: { shop },
        update: {},
        create: { shop, holidaysCsv: "" },
      }));

    const set = new Set(setting.holidaysCsv.split(",").map((x) => x.trim()).filter(Boolean));
    set.add(holiday);

    await prisma.deliverySetting.update({
      where: { shop },
      data: { holidaysCsv: [...set].sort().join(",") },
    });

    return { ok: true, message: "Holiday added." } satisfies ActionData;
  }

  if (intent === "remove_holiday") {
    const holiday = String(formData.get("holidayDate") ?? "").trim();
    const setting = await prisma.deliverySetting.findUnique({ where: { shop } });
    if (!setting) {
      return { ok: false, message: "No settings found for this shop." } satisfies ActionData;
    }

    const set = new Set(setting.holidaysCsv.split(",").map((x) => x.trim()).filter(Boolean));
    set.delete(holiday);

    await prisma.deliverySetting.update({
      where: { shop },
      data: { holidaysCsv: [...set].sort().join(",") },
    });

    return { ok: true, message: "Holiday removed." } satisfies ActionData;
  }

  if (intent === "upsert_single_pincode") {
    const pincode = String(formData.get("pincode") ?? "").trim();
    const deliveryDays = Number(formData.get("deliveryDays") ?? 0);
    const serviceable = parseBool(formData.get("serviceable"));
    const codAvailable = parseBool(formData.get("codAvailable"));
    const city = String(formData.get("city") ?? "").trim() || null;
    const state = String(formData.get("state") ?? "").trim() || null;
    const zone = String(formData.get("zone") ?? "").trim() || null;

    if (!validateIndianPincode(pincode)) {
      return { ok: false, message: "Please enter a valid 6-digit pincode." } satisfies ActionData;
    }

    if (!Number.isInteger(deliveryDays) || deliveryDays < 0 || deliveryDays > 30) {
      return { ok: false, message: "Delivery days should be between 0 and 30." } satisfies ActionData;
    }

    await prisma.pincode.upsert({
      where: { pincode },
      create: { pincode, deliveryDays, serviceable, codAvailable, city, state, zone },
      update: { deliveryDays, serviceable, codAvailable, city, state, zone },
    });

    return { ok: true, message: "Pincode saved." } satisfies ActionData;
  }

  if (intent === "bulk_import_csv") {
    const file = formData.get("pincodeCsv");
    if (!(file instanceof File)) {
      return { ok: false, message: "Please upload a CSV file." } satisfies ActionData;
    }

    if (file.size > 2 * 1024 * 1024) {
      return { ok: false, message: "CSV should be smaller than 2MB." } satisfies ActionData;
    }

    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length === 0) {
      return { ok: false, message: "CSV has no data rows." } satisfies ActionData;
    }

    let success = 0;
    let failed = 0;

    for (const row of rows.slice(0, 10000)) {
      const pincode = String(row.pincode ?? "").trim();
      const deliveryDays = Number(row.delivery_days ?? row.deliverydays ?? "");
      const serviceable = String(row.serviceable ?? "true").toLowerCase() !== "false";
      const codAvailable = String(row.cod_available ?? row.codavailable ?? "false").toLowerCase() === "true";
      const city = String(row.city ?? "").trim() || null;
      const state = String(row.state ?? "").trim() || null;
      const zone = String(row.zone ?? "").trim() || null;

      if (!validateIndianPincode(pincode) || !Number.isInteger(deliveryDays) || deliveryDays < 0 || deliveryDays > 30) {
        failed += 1;
        continue;
      }

      await prisma.pincode.upsert({
        where: { pincode },
        create: { pincode, deliveryDays, serviceable, codAvailable, city, state, zone },
        update: { deliveryDays, serviceable, codAvailable, city, state, zone },
      });
      success += 1;
    }

    return {
      ok: true,
      message: `CSV import completed. Success: ${success}, Failed: ${failed}.`,
    } satisfies ActionData;
  }

  if (intent === "bulk_manual_rows") {
    const raw = String(formData.get("manualRows") ?? "").trim();
    if (!raw) {
      return { ok: false, message: "Please paste at least one row." } satisfies ActionData;
    }

    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 1000);

    let success = 0;
    let failed = 0;

    for (const line of lines) {
      const [pincodeRaw, daysRaw, serviceableRaw, codRaw, cityRaw, stateRaw, zoneRaw] = line
        .split(",")
        .map((x) => x.trim());

      const pincode = pincodeRaw ?? "";
      const deliveryDays = Number(daysRaw ?? "");
      const serviceable = String(serviceableRaw ?? "true").toLowerCase() !== "false";
      const codAvailable = String(codRaw ?? "false").toLowerCase() === "true";
      const city = cityRaw || null;
      const state = stateRaw || null;
      const zone = zoneRaw || null;

      if (!validateIndianPincode(pincode) || !Number.isInteger(deliveryDays) || deliveryDays < 0 || deliveryDays > 30) {
        failed += 1;
        continue;
      }

      await prisma.pincode.upsert({
        where: { pincode },
        create: { pincode, deliveryDays, serviceable, codAvailable, city, state, zone },
        update: { deliveryDays, serviceable, codAvailable, city, state, zone },
      });
      success += 1;
    }

    return {
      ok: true,
      message: `Manual import completed. Success: ${success}, Failed: ${failed}.`,
    } satisfies ActionData;
  }

  return { ok: false, message: "Unsupported action." } satisfies ActionData;
}

export default function DeliverySettingsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const isSaving = fetcher.state !== "idle";
  const holidays = data.setting.holidaysCsv
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();

  return (
    <s-page heading="Delivery settings">
      <div className="delivery-admin">
        <div className="delivery-admin__hero">
          <h2>Setup in minutes</h2>
          <p>Configure delivery rules, upload pincodes in bulk, and keep holidays updated from one screen.</p>
          <div className="delivery-admin__meta">
            <span>{data.shop}</span>
            <span>{data.samplePincodes.length} pincodes shown</span>
          </div>
        </div>

        {fetcher.data ? (
          <div className={`delivery-admin__alert ${fetcher.data.ok ? "success" : "error"}`}>{fetcher.data.message}</div>
        ) : null}

        <s-section heading="1) Quick settings">
          <fetcher.Form method="post" className="delivery-admin__card">
            <input type="hidden" name="intent" value="save_settings" />
            <div className="delivery-admin__grid two">
              <label className="field">
                <span>Cutoff hour (0-23)</span>
                <input name="cutoffHour24" type="number" min={0} max={23} defaultValue={data.setting.cutoffHour24} />
              </label>

              <label className="field">
                <span>Weekend days (0=Sun, 6=Sat)</span>
                <input name="weekendDaysCsv" type="text" defaultValue={data.setting.weekendDaysCsv} placeholder="0 or 0,6" />
              </label>

              <label className="field">
                <span>Courier timeout (ms)</span>
                <input name="courierTimeoutMs" type="number" min={500} defaultValue={data.setting.courierTimeoutMs} />
              </label>

              <label className="field">
                <span>Retry count (0-3)</span>
                <input name="retryCount" type="number" min={0} max={3} defaultValue={data.setting.retryCount} />
              </label>
            </div>

            <label className="field" style={{ marginTop: 12 }}>
              <span>Holidays CSV (YYYY-MM-DD)</span>
              <input name="holidaysCsv" type="text" defaultValue={data.setting.holidaysCsv} placeholder="2026-01-26,2026-08-15" />
            </label>

            <div className="delivery-admin__checks">
              <label>
                <input name="courierEnabled" type="checkbox" defaultChecked={data.setting.courierEnabled} /> Enable courier API as primary source
              </label>
              <label>
                <input name="dbFallbackEnabled" type="checkbox" defaultChecked={data.setting.dbFallbackEnabled} /> Enable DB fallback
              </label>
            </div>

            <button type="submit" className="primary-btn" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save settings"}
            </button>
          </fetcher.Form>
        </s-section>

        <s-section heading="2) Holiday dates">
          <div className="delivery-admin__card">
            <fetcher.Form method="post" className="delivery-admin__inline-form">
              <input type="hidden" name="intent" value="add_holiday" />
              <input type="date" name="holidayDate" required />
              <button type="submit" className="primary-btn" disabled={isSaving}>Add holiday</button>
            </fetcher.Form>

            <div className="delivery-admin__chips">
              {holidays.length === 0 ? (
                <span className="delivery-admin__muted">No holidays added yet.</span>
              ) : (
                holidays.map((holiday) => (
                  <fetcher.Form key={holiday} method="post">
                    <input type="hidden" name="intent" value="remove_holiday" />
                    <input type="hidden" name="holidayDate" value={holiday} />
                    <button type="submit" className="chip-btn">
                      {holiday} x
                    </button>
                  </fetcher.Form>
                ))
              )}
            </div>
          </div>
        </s-section>

        <s-section heading="3) Bulk pincode upload">
          <div className="delivery-admin__card">
            <p className="delivery-admin__muted">CSV columns: <code>pincode,delivery_days,serviceable,cod_available,city,state,zone</code></p>
            <fetcher.Form method="post" encType="multipart/form-data" className="delivery-admin__inline-form">
              <input type="hidden" name="intent" value="bulk_import_csv" />
              <input type="file" name="pincodeCsv" accept=".csv,text/csv" required />
              <button type="submit" className="primary-btn" disabled={isSaving}>Import CSV</button>
            </fetcher.Form>
          </div>
        </s-section>

        <s-section heading="4) Add one pincode">
          <fetcher.Form method="post" className="delivery-admin__card">
            <input type="hidden" name="intent" value="upsert_single_pincode" />
            <div className="delivery-admin__grid three">
              <label className="field">
                <span>Pincode</span>
                <input name="pincode" placeholder="400001" maxLength={6} required />
              </label>
              <label className="field">
                <span>Delivery days</span>
                <input name="deliveryDays" type="number" min={0} max={30} placeholder="2" required />
              </label>
              <label className="field">
                <span>Zone</span>
                <input name="zone" placeholder="metro" />
              </label>
              <label className="field">
                <span>City</span>
                <input name="city" placeholder="Mumbai" />
              </label>
              <label className="field">
                <span>State</span>
                <input name="state" placeholder="Maharashtra" />
              </label>
            </div>

            <div className="delivery-admin__checks" style={{ marginTop: 12 }}>
              <label><input name="serviceable" type="checkbox" defaultChecked /> Serviceable</label>
              <label><input name="codAvailable" type="checkbox" /> COD available</label>
            </div>

            <button type="submit" className="primary-btn" disabled={isSaving}>Save pincode</button>
          </fetcher.Form>
        </s-section>

        <s-section heading="5) Add multiple pincodes manually">
          <fetcher.Form method="post" className="delivery-admin__card">
            <input type="hidden" name="intent" value="bulk_manual_rows" />
            <p className="delivery-admin__muted" style={{ marginTop: 0 }}>
              One row per line, comma separated: <code>pincode,delivery_days,serviceable,cod_available,city,state,zone</code>
            </p>
            <textarea
              name="manualRows"
              rows={7}
              placeholder={"400001,2,true,true,Mumbai,Maharashtra,metro\n560001,4,true,false,Bengaluru,Karnataka,metro"}
              className="delivery-admin__textarea"
              required
            />
            <div style={{ marginTop: 10 }}>
              <button type="submit" className="primary-btn" disabled={isSaving}>Save manual rows</button>
            </div>
          </fetcher.Form>
        </s-section>

        <s-section heading="6) Recent records">
          <div className="delivery-admin__card delivery-admin__table-wrap">
            <table className="delivery-admin__table">
              <thead>
                <tr>
                  <th>Pincode</th>
                  <th>Days</th>
                  <th>Serviceable</th>
                  <th>COD</th>
                  <th>City</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {data.samplePincodes.map((row) => (
                  <tr key={row.id}>
                    <td>{row.pincode}</td>
                    <td>{row.deliveryDays}</td>
                    <td>{row.serviceable ? "Yes" : "No"}</td>
                    <td>{row.codAvailable ? "Yes" : "No"}</td>
                    <td>{row.city ?? "-"}</td>
                    <td>{row.state ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </s-section>
      </div>

      <style>{`
        .delivery-admin { display: grid; gap: 14px; }
        .delivery-admin__hero { border: 1px solid #d8dee8; border-radius: 14px; padding: 18px; background: linear-gradient(135deg,#f8fbff,#f4f7f2); }
        .delivery-admin__hero h2 { margin: 0; font-size: 18px; color: #102a43; }
        .delivery-admin__hero p { margin: 6px 0 0; color: #334e68; font-size: 14px; }
        .delivery-admin__meta { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
        .delivery-admin__meta span { background: #e6eff8; color: #102a43; font-size: 12px; padding: 4px 8px; border-radius: 999px; }
        .delivery-admin__alert { border-radius: 10px; padding: 10px 12px; font-size: 13px; border: 1px solid; }
        .delivery-admin__alert.success { background: #edfdf5; border-color: #86efac; color: #166534; }
        .delivery-admin__alert.error { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
        .delivery-admin__card { border: 1px solid #d8dee8; border-radius: 12px; padding: 14px; background: #ffffff; }
        .delivery-admin__grid { display: grid; gap: 10px; }
        .delivery-admin__grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .delivery-admin__grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .field { display: grid; gap: 6px; font-size: 13px; color: #243b53; }
        .field input { border: 1px solid #bcccdc; border-radius: 8px; min-height: 36px; padding: 8px 10px; font-size: 14px; }
        .delivery-admin__checks { display: grid; gap: 8px; margin: 14px 0; font-size: 13px; color: #243b53; }
        .delivery-admin__inline-form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .delivery-admin__chips { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
        .delivery-admin__muted { color: #627d98; font-size: 13px; }
        .primary-btn { background: #0b6bcb; color: #fff; border: 0; border-radius: 8px; min-height: 36px; padding: 0 12px; font-size: 13px; cursor: pointer; }
        .primary-btn:disabled { opacity: .65; cursor: not-allowed; }
        .chip-btn { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 999px; min-height: 30px; padding: 0 10px; font-size: 12px; cursor: pointer; }
        .delivery-admin__table-wrap { overflow-x: auto; }
        .delivery-admin__textarea { width: 100%; border: 1px solid #bcccdc; border-radius: 8px; padding: 10px; font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace; }
        .delivery-admin__table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .delivery-admin__table th { text-align: left; color: #334e68; padding: 8px; border-bottom: 1px solid #d9e2ec; }
        .delivery-admin__table td { padding: 8px; border-bottom: 1px solid #eef2f6; color: #102a43; }
        @media (max-width: 860px) {
          .delivery-admin__grid.two, .delivery-admin__grid.three { grid-template-columns: 1fr; }
        }
      `}</style>
    </s-page>
  );
}
