// The embed widget in the claim app's languages: English unless the partner site asks for another (?lang=).
export type Hazard = "flood" | "heat" | "wind"
type Strings = {
    open: (hz: Hazard, until: string) => string
    watching: (until: string) => string
    closed: (since: string) => string
    latest: string; trigger: string; reported: string
    pool: string; paid: string; households: string; each: string; of: string
    verify: string; loading: string; none: (id: number) => string; noId: string; down: string
    meter: (v: number, t: number) => string
}

export const E: Record<string, Strings> = {
    en: {
        open: (hz, until) => `${{ flood: "Flood", heat: "Heatwave", wind: "Cyclone" }[hz]} trigger fired: claims open until ${until}`,
        watching: (until) => `Watching the forecast until ${until}`,
        closed: (since) => `Claims closed ${since}`,
        latest: "Latest forecast", trigger: "trigger", reported: "reported",
        pool: "Pool", paid: "Paid out", households: "Households paid", each: "Each household", of: "of",
        verify: "Verify every payout on Naungan ↗", loading: "Loading program…", none: (id) => `There is no program #${id}.`,
        noId: "Add ?program=<id> to the address.", down: "Program data is unavailable right now; retrying.",
        meter: (v, t) => `Latest forecast ${v}% against a trigger of ${t}%`
    },
    id: {
        open: (hz, until) => `Pemicu ${{ flood: "banjir", heat: "gelombang panas", wind: "siklon" }[hz]} tercapai: klaim dibuka sampai ${until}`,
        watching: (until) => `Memantau prakiraan sampai ${until}`,
        closed: (since) => `Klaim ditutup ${since}`,
        latest: "Prakiraan terakhir", trigger: "pemicu", reported: "dilaporkan",
        pool: "Dana", paid: "Tersalurkan", households: "Keluarga dibayar", each: "Per keluarga", of: "dari",
        verify: "Periksa setiap pembayaran di Naungan ↗", loading: "Memuat program…", none: (id) => `Program #${id} tidak ada.`,
        noId: "Tambahkan ?program=<id> ke alamat.", down: "Data program sedang tidak tersedia; mencoba lagi.",
        meter: (v, t) => `Prakiraan terakhir ${v}% dibanding pemicu ${t}%`
    },
    bn: {
        open: (hz, until) => `${{ flood: "বন্যার", heat: "তাপপ্রবাহের", wind: "ঘূর্ণিঝড়ের" }[hz]} ট্রিগার পূরণ হয়েছে: ${until} পর্যন্ত দাবি খোলা`,
        watching: (until) => `${until} পর্যন্ত পূর্বাভাস পর্যবেক্ষণ চলছে`,
        closed: (since) => `দাবি বন্ধ হয়েছে ${since}`,
        latest: "সর্বশেষ পূর্বাভাস", trigger: "ট্রিগার", reported: "জানানো হয়েছে",
        pool: "তহবিল", paid: "প্রদান করা হয়েছে", households: "পরিবার পেয়েছে", each: "প্রতি পরিবার", of: "এর মধ্যে",
        verify: "নাউঙ্গানে প্রতিটি প্রদান যাচাই করুন ↗", loading: "প্রোগ্রাম লোড হচ্ছে…", none: (id) => `প্রোগ্রাম #${id} নেই।`,
        noId: "ঠিকানায় ?program=<id> যোগ করুন।", down: "প্রোগ্রামের তথ্য এখন পাওয়া যাচ্ছে না; আবার চেষ্টা করা হচ্ছে।",
        meter: (v, t) => `সর্বশেষ পূর্বাভাস ${v}%, ট্রিগার ${t}%`
    },
    es: {
        open: (hz, until) => `Se activó el disparador de ${{ flood: "inundación", heat: "ola de calor", wind: "ciclón" }[hz]}: reclamos abiertos hasta el ${until}`,
        watching: (until) => `Vigilando el pronóstico hasta el ${until}`,
        closed: (since) => `Reclamos cerrados el ${since}`,
        latest: "Último pronóstico", trigger: "disparador", reported: "informado",
        pool: "Fondo", paid: "Pagado", households: "Hogares pagados", each: "Por hogar", of: "de",
        verify: "Verifique cada pago en Naungan ↗", loading: "Cargando programa…", none: (id) => `No existe el programa #${id}.`,
        noId: "Agregue ?program=<id> a la dirección.", down: "Los datos del programa no están disponibles ahora; reintentando.",
        meter: (v, t) => `Último pronóstico ${v}% frente a un disparador de ${t}%`
    },
    sw: {
        open: (hz, until) => `Kichocheo cha ${{ flood: "mafuriko", heat: "wimbi la joto", wind: "kimbunga" }[hz]} kimefikiwa: madai yako wazi hadi ${until}`,
        watching: (until) => `Inafuatilia utabiri hadi ${until}`,
        closed: (since) => `Madai yalifungwa ${since}`,
        latest: "Utabiri wa karibuni", trigger: "kichocheo", reported: "imeripotiwa",
        pool: "Mfuko", paid: "Imelipwa", households: "Kaya zilizolipwa", each: "Kila kaya", of: "kati ya",
        verify: "Hakiki kila malipo kwenye Naungan ↗", loading: "Inapakia programu…", none: (id) => `Hakuna programu #${id}.`,
        noId: "Ongeza ?program=<id> kwenye anwani.", down: "Taarifa za programu hazipatikani sasa; inajaribu tena.",
        meter: (v, t) => `Utabiri wa karibuni ${v}% dhidi ya kichocheo cha ${t}%`
    },
    pt: {
        open: (hz, until) => `Limiar de ${{ flood: "cheia", heat: "onda de calor", wind: "ciclone" }[hz]} atingido: pedidos abertos até ${until}`,
        watching: (until) => `A vigiar a previsão até ${until}`,
        closed: (since) => `Pedidos fechados em ${since}`,
        latest: "Última previsão", trigger: "limiar", reported: "comunicado",
        pool: "Fundo", paid: "Pago", households: "Agregados pagos", each: "Por agregado", of: "de",
        verify: "Verifique cada pagamento no Naungan ↗", loading: "A carregar o programa…", none: (id) => `Não existe o programa #${id}.`,
        noId: "Acrescente ?program=<id> ao endereço.", down: "Os dados do programa não estão disponíveis agora; a tentar de novo.",
        meter: (v, t) => `Última previsão ${v}% face a um limiar de ${t}%`
    },
    fil: {
        open: (hz, until) => `Naabot ang antas ng ${{ flood: "baha", heat: "matinding init", wind: "bagyo" }[hz]}: bukas ang pag-claim hanggang ${until}`,
        watching: (until) => `Binabantayan ang taya hanggang ${until}`,
        closed: (since) => `Sarado ang pag-claim mula ${since}`,
        latest: "Pinakabagong taya", trigger: "antas", reported: "iniulat",
        pool: "Pondo", paid: "Naibayad", households: "Pamilyang nabayaran", each: "Bawat pamilya", of: "sa",
        verify: "Suriin ang bawat bayad sa Naungan ↗", loading: "Nilo-load ang programa…", none: (id) => `Walang programang #${id}.`,
        noId: "Idagdag ang ?program=<id> sa address.", down: "Hindi makuha ang datos ng programa ngayon; sinusubukan ulit.",
        meter: (v, t) => `Pinakabagong taya ${v}% laban sa antas na ${t}%`
    }
}

/** The partner site's ?lang= if we have it, else English. */
export const embedLang = (asked: string | null) => {
    const a = asked?.split(/[-_]/)[0].toLowerCase() // "fil", "pt-MZ": the language subtag, not two letters
    return a && a in E ? a : "en"
}
