// The embed widget in the claim app's five languages. It follows the partner site (?lang=) or its visitor's browser,
// not the program's country: a donor's English page embedding a Bangladesh program should read in English.
type Strings = {
    open: (heat: boolean, until: string) => string
    watching: (until: string) => string
    closed: (since: string) => string
    latest: string; trigger: string; reported: string
    pool: string; paid: string; households: string; each: string; of: string
    verify: string; loading: string; none: (id: number) => string; noId: string; down: string
    meter: (v: number, t: number) => string
}

export const E: Record<string, Strings> = {
    en: {
        open: (heat, until) => `${heat ? "Heatwave" : "Flood"} trigger fired: claims open until ${until}`,
        watching: (until) => `Watching the forecast until ${until}`,
        closed: (since) => `Claims closed ${since}`,
        latest: "Latest forecast", trigger: "trigger", reported: "reported",
        pool: "Pool", paid: "Paid out", households: "Households paid", each: "Each household", of: "of",
        verify: "Verify every payout on Naungan ↗", loading: "Loading program…", none: (id) => `There is no program #${id}.`,
        noId: "Add ?program=<id> to the address.", down: "Program data is unavailable right now; retrying.",
        meter: (v, t) => `Latest forecast ${v}% against a trigger of ${t}%`
    },
    id: {
        open: (heat, until) => `Pemicu ${heat ? "gelombang panas" : "banjir"} tercapai: klaim dibuka sampai ${until}`,
        watching: (until) => `Memantau prakiraan sampai ${until}`,
        closed: (since) => `Klaim ditutup ${since}`,
        latest: "Prakiraan terakhir", trigger: "pemicu", reported: "dilaporkan",
        pool: "Dana", paid: "Tersalurkan", households: "Keluarga dibayar", each: "Per keluarga", of: "dari",
        verify: "Periksa setiap pembayaran di Naungan ↗", loading: "Memuat program…", none: (id) => `Program #${id} tidak ada.`,
        noId: "Tambahkan ?program=<id> ke alamat.", down: "Data program sedang tidak tersedia; mencoba lagi.",
        meter: (v, t) => `Prakiraan terakhir ${v}% dibanding pemicu ${t}%`
    },
    bn: {
        open: (heat, until) => `${heat ? "তাপপ্রবাহের" : "বন্যার"} ট্রিগার পূরণ হয়েছে: ${until} পর্যন্ত দাবি খোলা`,
        watching: (until) => `${until} পর্যন্ত পূর্বাভাস পর্যবেক্ষণ চলছে`,
        closed: (since) => `দাবি বন্ধ হয়েছে ${since}`,
        latest: "সর্বশেষ পূর্বাভাস", trigger: "ট্রিগার", reported: "জানানো হয়েছে",
        pool: "তহবিল", paid: "প্রদান করা হয়েছে", households: "পরিবার পেয়েছে", each: "প্রতি পরিবার", of: "এর মধ্যে",
        verify: "নাউঙ্গানে প্রতিটি প্রদান যাচাই করুন ↗", loading: "প্রোগ্রাম লোড হচ্ছে…", none: (id) => `প্রোগ্রাম #${id} নেই।`,
        noId: "ঠিকানায় ?program=<id> যোগ করুন।", down: "প্রোগ্রামের তথ্য এখন পাওয়া যাচ্ছে না; আবার চেষ্টা করা হচ্ছে।",
        meter: (v, t) => `সর্বশেষ পূর্বাভাস ${v}%, ট্রিগার ${t}%`
    },
    es: {
        open: (heat, until) => `Se activó el disparador de ${heat ? "ola de calor" : "inundación"}: reclamos abiertos hasta el ${until}`,
        watching: (until) => `Vigilando el pronóstico hasta el ${until}`,
        closed: (since) => `Reclamos cerrados el ${since}`,
        latest: "Último pronóstico", trigger: "disparador", reported: "informado",
        pool: "Fondo", paid: "Pagado", households: "Hogares pagados", each: "Por hogar", of: "de",
        verify: "Verifique cada pago en Naungan ↗", loading: "Cargando programa…", none: (id) => `No existe el programa #${id}.`,
        noId: "Agregue ?program=<id> a la dirección.", down: "Los datos del programa no están disponibles ahora; reintentando.",
        meter: (v, t) => `Último pronóstico ${v}% frente a un disparador de ${t}%`
    },
    sw: {
        open: (heat, until) => `Kichocheo cha ${heat ? "wimbi la joto" : "mafuriko"} kimefikiwa: madai yako wazi hadi ${until}`,
        watching: (until) => `Inafuatilia utabiri hadi ${until}`,
        closed: (since) => `Madai yalifungwa ${since}`,
        latest: "Utabiri wa karibuni", trigger: "kichocheo", reported: "imeripotiwa",
        pool: "Mfuko", paid: "Imelipwa", households: "Kaya zilizolipwa", each: "Kila kaya", of: "kati ya",
        verify: "Hakiki kila malipo kwenye Naungan ↗", loading: "Inapakia programu…", none: (id) => `Hakuna programu #${id}.`,
        noId: "Ongeza ?program=<id> kwenye anwani.", down: "Taarifa za programu hazipatikani sasa; inajaribu tena.",
        meter: (v, t) => `Utabiri wa karibuni ${v}% dhidi ya kichocheo cha ${t}%`
    }
}

/** ?lang= if we have it, else the first of the visitor's languages we have, else English. */
export const embedLang = (asked: string | null, browser: readonly string[] = []) =>
    [asked, ...browser].map((l) => l?.slice(0, 2).toLowerCase()).find((l): l is string => !!l && l in E) ?? "en"
