# Uploads appstore/screenshots/ to the App Store version through the App Store Connect API, using the same
# screenshot display types as Salvo Command's approved listing. Run by .github/workflows/appstore-screenshots.yml.
# Replaces whatever screenshots the version had before. Prints what it did, never the key.
import os, sys, glob, time, hashlib, jwt, requests
from PIL import Image

API = "https://api.appstoreconnect.apple.com"
APP_BUNDLE = "com.playbyear.hullandhonor"
REFERENCE_APP = "com.playbyear.salvocommand"
def say(t):
    print(t)
    if os.environ.get("GITHUB_STEP_SUMMARY"): open(os.environ["GITHUB_STEP_SUMMARY"], "a").write(t + "\n\n")
token = jwt.encode({"iss": os.environ["ASC_ISSUER_ID"].strip(), "iat": int(time.time()), "exp": int(time.time()) + 1100, "aud": "appstoreconnect-v1"},
                   os.environ["ASC_KEY_P8"].strip(), algorithm="ES256", headers={"kid": os.environ["ASC_KEY_ID"].strip(), "typ": "JWT"})
S = requests.Session(); S.headers.update({"Authorization": "Bearer " + token, "Content-Type": "application/json"})
def call(method, path, **kw):
    r = S.request(method, API + path, timeout=60, **kw)
    if r.status_code >= 400:
        errs = r.json().get("errors", []) if r.text.startswith("{") else []
        raise SystemExit(say(f"STOPPED: {method} {path.split('?')[0]} -> {r.status_code}: " + "; ".join((e.get("detail") or e.get("title", "")) for e in errs)[:1500]) or 1)
    return r.json() if r.text else {}

def en_loc(bundle, editable):
    app = call("GET", f"/v1/apps?filter[bundleId]={bundle}")["data"][0]["id"]
    vers = call("GET", f"/v1/apps/{app}/appStoreVersions?filter[platform]=IOS")["data"]
    if editable: vers = [v for v in vers if v["attributes"]["appStoreState"] in ("PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED")]
    ver = vers[0]["id"]
    return [l for l in call("GET", f"/v1/appStoreVersions/{ver}/appStoreVersionLocalizations")["data"] if l["attributes"]["locale"] == "en-US"][0]["id"]

# Which display types the reference app used, and at what pixel sizes.
ref_types = {}
for s in call("GET", f"/v1/appStoreVersionLocalizations/{en_loc(REFERENCE_APP, False)}/appScreenshotSets")["data"]:
    shots = call("GET", f"/v1/appScreenshotSets/{s['id']}/appScreenshots")["data"]
    dims = {(x["attributes"]["imageAsset"] or {}).get("width") for x in shots if x["attributes"].get("imageAsset")}
    ref_types[s["attributes"]["screenshotDisplayType"]] = dims
say("Reference display types: " + ", ".join(f"{k} {sorted(v)}" for k, v in ref_types.items()))

def type_for(prefix):
    for t, dims in ref_types.items():
        if (prefix == "iphone" and t.startswith("APP_IPHONE")) or (prefix == "ipad" and t.startswith("APP_IPAD")): return t
    return {"iphone": "APP_IPHONE_67", "ipad": "APP_IPAD_PRO_3GEN_129"}[prefix]

LOC = en_loc(APP_BUNDLE, True)
existing = {s["attributes"]["screenshotDisplayType"]: s["id"] for s in call("GET", f"/v1/appStoreVersionLocalizations/{LOC}/appScreenshotSets")["data"]}
for prefix in ("iphone", "ipad"):
    dtype = type_for(prefix)
    files = sorted(glob.glob(f"appstore/screenshots/{prefix}-*.png"))
    if dtype in existing:
        for x in call("GET", f"/v1/appScreenshotSets/{existing[dtype]}/appScreenshots")["data"]: call("DELETE", f"/v1/appScreenshots/{x['id']}")
        set_id = existing[dtype]
    else:
        set_id = call("POST", "/v1/appScreenshotSets", json={"data": {"type": "appScreenshotSets", "attributes": {"screenshotDisplayType": dtype},
                      "relationships": {"appStoreVersionLocalization": {"data": {"type": "appStoreVersionLocalizations", "id": LOC}}}}})["data"]["id"]
    for f in files:
        data = open(f, "rb").read()
        res = call("POST", "/v1/appScreenshots", json={"data": {"type": "appScreenshots", "attributes": {"fileName": os.path.basename(f), "fileSize": len(data)},
                   "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": set_id}}}}})["data"]
        for op in res["attributes"]["uploadOperations"]:
            chunk = data[op["offset"]:op["offset"] + op["length"]]
            r = requests.request(op["method"], op["url"], data=chunk, headers={h["name"]: h["value"] for h in op["requestHeaders"]}, timeout=120)
            if r.status_code >= 300: raise SystemExit(say(f"STOPPED: upload of {f} failed ({r.status_code})") or 1)
        call("PATCH", f"/v1/appScreenshots/{res['id']}", json={"data": {"type": "appScreenshots", "id": res["id"],
             "attributes": {"uploaded": True, "sourceFileChecksum": hashlib.md5(data).hexdigest()}}})
    w, h = Image.open(files[0]).size
    say(f"OK: {len(files)} {prefix} screenshots ({w} x {h}) uploaded as {dtype}")
# Wait for Apple to process them, then report.
time.sleep(20)
for s in call("GET", f"/v1/appStoreVersionLocalizations/{LOC}/appScreenshotSets")["data"]:
    shots = call("GET", f"/v1/appScreenshotSets/{s['id']}/appScreenshots")["data"]
    states = [x["attributes"]["assetDeliveryState"]["state"] for x in shots]
    say(f"{s['attributes']['screenshotDisplayType']}: " + ", ".join(states))
