// Where a program runs and what its money is worth there: country from the program's on-chain coordinates
// (bundled borders, no service), its currency (ISO 4217) and main language (CLDR likely
// subtags, built into Intl), and the day's USD rates. Everything is kept in localStorage so a phone that
// once had signal still shows it offline.

export type Place = { code: string; name?: string; continent?: string }

const read = <T>(k: string): T | null => {
    try {
        return JSON.parse(localStorage.getItem(k) ?? "null")
    } catch {
        return null
    }
}
const write = (k: string, v: unknown) => {
    try {
        localStorage.setItem(k, JSON.stringify(v))
    } catch {} // private window or storage blocked: works, just without the offline copy
}

/**
 * Country of a point, offline: country-coder (the borders OpenStreetMap's iD editor uses) is bundled as its own
 * chunk, loaded the first time a page needs it, so no geocoding service sees where programs are or can rate-limit
 * or ban the page (null offline if it was never loaded). Its UN M49 region stands in for the continent (the Americas count as one). Null at sea.
 */
export async function placeOf(lat: number, lon: number): Promise<Place | null> {
    const k = `naungan-place:${lat},${lon}`
    const saved = read<Place>(k)
    if (saved?.code) return saved
    const cc = await import("@rapideditor/country-coder").catch(() => null) // offline before it was ever loaded
    if (!cc) return null
    const code = cc.iso1A2Code([lon, lat])
    if (!code || !/^[A-Z]{2}$/.test(code)) return null
    const continent = cc.featuresContaining([lon, lat]).find((f) => f.properties.level === "region")?.properties.nameEn
    const p: Place = { code, name: new Intl.DisplayNames(["en"], { type: "region" }).of(code), continent }
    write(k, p)
    return p
}

/** ISO 3166 country → ISO 4217 currency (datasets/country-codes). */
const CURRENCY: Record<string, string> = Object.fromEntries("ADEURAEAEDAFAFNAGXCDAIXCDALALLAMAMDAOAOAARARSASUSDATEURAUAUDAWAWGAXEURAZAZNBABAMBBBBDBDBDTBEEURBFXOFBGEURBHBHDBIBIFBJXOFBLEURBMBMDBNBNDBOBOBBQUSDBRBRLBSBSDBTINRBVNOKBWBWPBYBYNBZBZDCACADCCAUDCDCDFCFXAFCGXAFCHCHFCIXOFCKNZDCLCLPCMXAFCNCNYCOCOPCRCRCCUCUPCVCVECWXCGCXAUDCYEURCZCZKDEEURDJDJFDKDKKDMXCDDODOPDZDZDECUSDEEEUREGEGPEHMADERERNESEURETETBFIEURFJFJDFKFKPFMUSDFODKKFREURGAXAFGBGBPGDXCDGEGELGFEURGGGBPGHGHSGIGIPGLDKKGMGMDGNGNFGPEURGQXAFGREURGTGTQGUUSDGWXOFGYGYDHKHKDHMAUDHNHNLHREURHTHTGHUHUFIDIDRIEEURILILSIMGBPININRIOUSDIQIQDIRIRRISISKITEURJEGBPJMJMDJOJODJPJPYKEKESKGKGSKHKHRKIAUDKMKMFKNXCDKPKPWKRKRWKWKWDKYKYDKZKZTLALAKLBLBPLCXCDLICHFLKLKRLRLRDLSLSLLTEURLUEURLVEURLYLYDMAMADMCEURMDMDLMEEURMFEURMGMGAMHUSDMKMKDMLXOFMMMMKMNMNTMOMOPMPUSDMQEURMRMRUMSXCDMTEURMUMURMVMVRMWMWKMXMXNMYMYRMZMZNNANADNCXPFNEXOFNFAUDNGNGNNINIONLEURNONOKNPNPRNRAUDNUNZDNZNZDOMOMRPAPABPEPENPFXPFPGPGKPHPHPPKPKRPLPLNPMEURPNNZDPRUSDPTEURPWUSDPYPYGQAQARREEURRORONRSRSDRURUBRWRWFSASARSBSBDSCSCRSDSDGSESEKSGSGDSHSHPSIEURSJNOKSKEURSLSLESMEURSNXOFSOSOSSRSRDSSSSPSTSTNSVSVCSXXCGSYSYPSZSZLTCUSDTDXAFTFEURTGXOFTHTHBTJTJSTKNZDTLUSDTMTMTTNTNDTOTOPTRTRYTTTTDTVAUDTWTWDTZTZSUAUAHUGUGXUMUSDUSUSDUYUYUUZUZSVAEURVCXCDVEVESVGUSDVIUSDVNVNDVUVUVWFXPFWSWSTYEYERYTEURZAZARZMZMWZWZWG".match(/.{5}/g)!.map((x) => [x.slice(0, 2), x.slice(2)]))
export const currencyOf = (cc?: string) => (cc ? CURRENCY[cc] : undefined)

/** The country's most likely language (CLDR): BD → bn, HN → es, ID → id. */
export const languageOf = (cc: string) => new Intl.Locale(`und-${cc}`).maximize().language

/** Regional-indicator flag emoji for a country code. */
export const flagOf = (cc?: string) => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((ch) => 0x1f1a5 + ch.charCodeAt(0))) : "")

export type Rates = { rates: Record<string, number>; day: number; at: number }
/** USD rates (USDC is redeemable 1:1 for US dollars), refreshed twice a day, the last copy when offline. */
export async function usdRates(): Promise<Rates | null> {
    const k = "naungan-fx-usd"
    const saved = read<Rates>(k)
    if (saved && Date.now() - saved.at < 12 * 3600e3) return saved
    try {
        const j = await (await fetch("https://open.er-api.com/v6/latest/USD")).json()
        if (j.result !== "success" || !j.rates) throw new Error("no rate")
        const fx: Rates = { rates: j.rates, day: j.time_last_update_unix * 1000, at: Date.now() }
        write(k, fx)
        return fx
    } catch {
        return saved
    }
}

/** "≈ ৳124" (or, with display "name", "≈ 124 বাংলাদেশী টাকা" for reading aloud) for a USDC amount in a country's currency, or null for dollar countries and unknown rates. */
export function localMoney(usdc: number, cc: string | undefined, fx: Rates | null, locale: string, display: "symbol" | "name" = "symbol") {
    const cur = currencyOf(cc)
    const rate = cur && fx?.rates?.[cur]
    if (!cur || cur === "USD" || !rate) return null
    const text = new Intl.NumberFormat(locale, { style: "currency", currency: cur, currencyDisplay: display, maximumFractionDigits: rate > 10 ? 0 : 2 }).format(usdc * rate)
    return { text: `≈ ${text}`, currency: new Intl.DisplayNames([locale], { type: "currency" }).of(cur) ?? cur, day: new Date(fx!.day) }
}
