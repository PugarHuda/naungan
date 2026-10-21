// Registration poster text in the claim app's five languages. The poster prints in English, or in the language an
// agency asks for (?lang=) with English underneath, so field staff can read it too.
export type Hazard = "flood" | "heat" | "wind"
type Strings = {
    title: string
    per: (amount: string, hz: Hazard) => string
    steps: (hz: Hazard) => [string, string, string]
    privacy: string
}

export const P: Record<string, Strings> = {
    en: {
        title: "Register for early cash support",
        per: (a, hz) => `${a} per household, sent before a ${{ flood: "flood", heat: "heatwave", wind: "cyclone" }[hz]} arrives`,
        steps: (hz) => ["Point your phone camera at this code and open the link.", "Your phone shows a code. Show it to the agency staff.", `When a ${{ flood: "flood", heat: "heatwave", wind: "cyclone" }[hz]} is forecast, open the page again and tap Claim.`],
        privacy: "Your name never goes on the blockchain. Only your phone can claim."
    },
    id: {
        title: "Daftar bantuan tunai dini",
        per: (a, hz) => `${a} per keluarga, dikirim sebelum ${{ flood: "banjir", heat: "gelombang panas", wind: "siklon" }[hz]} datang`,
        steps: (hz) => ["Arahkan kamera ponsel ke kode ini dan buka tautannya.", "Ponsel Anda menampilkan kode. Tunjukkan ke petugas lembaga.", `Saat ${{ flood: "banjir", heat: "gelombang panas", wind: "siklon" }[hz]} diperkirakan, buka halaman lagi dan tekan Klaim.`],
        privacy: "Nama Anda tidak pernah masuk ke blockchain. Hanya ponsel Anda yang bisa mengklaim."
    },
    bn: {
        title: "আগাম নগদ সহায়তার জন্য নিবন্ধন করুন",
        per: (a, hz) => `প্রতি পরিবার ${a}, ${{ flood: "বন্যা", heat: "তাপপ্রবাহ", wind: "ঘূর্ণিঝড়" }[hz]} আসার আগেই পাঠানো হয়`,
        steps: (hz) => ["ফোনের ক্যামেরা এই কোডের দিকে ধরুন এবং লিংকটি খুলুন।", "আপনার ফোন একটি কোড দেখাবে। সেটি সংস্থার কর্মীকে দেখান।", `${{ flood: "বন্যার", heat: "তাপপ্রবাহের", wind: "ঘূর্ণিঝড়ের" }[hz]} পূর্বাভাস হলে পেজটি আবার খুলে "দাবি করুন" চাপুন।`],
        privacy: "আপনার নাম কখনো ব্লকচেইনে যায় না। শুধু আপনার ফোনই দাবি করতে পারে।"
    },
    es: {
        title: "Inscríbase para recibir apoyo en efectivo anticipado",
        per: (a, hz) => `${a} por hogar, enviado antes de que llegue ${{ flood: "la inundación", heat: "la ola de calor", wind: "el ciclón" }[hz]}`,
        steps: (hz) => ["Apunte la cámara del teléfono a este código y abra el enlace.", "Su teléfono muestra un código. Muéstrelo al personal de la organización.", `Cuando se pronostique ${{ flood: "una inundación", heat: "una ola de calor", wind: "un ciclón" }[hz]}, abra la página otra vez y toque Reclamar.`],
        privacy: "Su nombre nunca va a la blockchain. Solo su teléfono puede reclamar."
    },
    sw: {
        title: "Jisajili kwa msaada wa fedha wa mapema",
        per: (a, hz) => `${a} kwa kila kaya, hutumwa kabla ${{ flood: "mafuriko hayajafika", heat: "wimbi la joto halijafika", wind: "kimbunga hakijafika" }[hz]}`,
        steps: (hz) => ["Elekeza kamera ya simu kwenye msimbo huu na ufungue kiungo.", "Simu yako itaonyesha msimbo. Muonyeshe mfanyakazi wa shirika.", `${{ flood: "Mafuriko yakitabiriwa", heat: "Wimbi la joto likitabiriwa", wind: "Kimbunga kikitabiriwa" }[hz]}, fungua ukurasa tena na ubonyeze Dai.`],
        privacy: "Jina lako haliendi kamwe kwenye blockchain. Ni simu yako tu inayoweza kudai."
    }
}

/** ?lang= if we have it (the poster then carries English underneath), else English. */
export function posterLang(asked: string | null): string {
    const a = asked?.slice(0, 2).toLowerCase()
    return a && a in P ? a : "en"
}
