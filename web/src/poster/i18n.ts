// Registration poster text in the claim app's five languages. The poster prints in English, or in the language an
// agency asks for (?lang=) with English underneath, so field staff can read it too.
type Strings = {
    title: string
    per: (amount: string, heat: boolean) => string
    steps: (heat: boolean) => [string, string, string]
    privacy: string
}

export const P: Record<string, Strings> = {
    en: {
        title: "Register for early cash support",
        per: (a, heat) => `${a} per household, sent before a ${heat ? "heatwave" : "flood"} arrives`,
        steps: (heat) => ["Point your phone camera at this code and open the link.", "Your phone shows a code. Show it to the agency staff.", `When a ${heat ? "heatwave" : "flood"} is forecast, open the page again and tap Claim.`],
        privacy: "Your name never goes on the blockchain. Only your phone can claim."
    },
    id: {
        title: "Daftar bantuan tunai dini",
        per: (a, heat) => `${a} per keluarga, dikirim sebelum ${heat ? "gelombang panas" : "banjir"} datang`,
        steps: (heat) => ["Arahkan kamera ponsel ke kode ini dan buka tautannya.", "Ponsel Anda menampilkan kode. Tunjukkan ke petugas lembaga.", `Saat ${heat ? "gelombang panas" : "banjir"} diperkirakan, buka halaman lagi dan tekan Klaim.`],
        privacy: "Nama Anda tidak pernah masuk ke blockchain. Hanya ponsel Anda yang bisa mengklaim."
    },
    bn: {
        title: "আগাম নগদ সহায়তার জন্য নিবন্ধন করুন",
        per: (a, heat) => `প্রতি পরিবার ${a}, ${heat ? "তাপপ্রবাহ" : "বন্যা"} আসার আগেই পাঠানো হয়`,
        steps: (heat) => ["ফোনের ক্যামেরা এই কোডের দিকে ধরুন এবং লিংকটি খুলুন।", "আপনার ফোন একটি কোড দেখাবে। সেটি সংস্থার কর্মীকে দেখান।", `${heat ? "তাপপ্রবাহের" : "বন্যার"} পূর্বাভাস হলে পেজটি আবার খুলে "দাবি করুন" চাপুন।`],
        privacy: "আপনার নাম কখনো ব্লকচেইনে যায় না। শুধু আপনার ফোনই দাবি করতে পারে।"
    },
    es: {
        title: "Inscríbase para recibir apoyo en efectivo anticipado",
        per: (a, heat) => `${a} por hogar, enviado antes de que llegue ${heat ? "la ola de calor" : "la inundación"}`,
        steps: (heat) => ["Apunte la cámara del teléfono a este código y abra el enlace.", "Su teléfono muestra un código. Muéstrelo al personal de la organización.", `Cuando se pronostique ${heat ? "una ola de calor" : "una inundación"}, abra la página otra vez y toque Reclamar.`],
        privacy: "Su nombre nunca va a la blockchain. Solo su teléfono puede reclamar."
    },
    sw: {
        title: "Jisajili kwa msaada wa fedha wa mapema",
        per: (a, heat) => `${a} kwa kila kaya, hutumwa kabla ${heat ? "wimbi la joto" : "mafuriko"} hayajafika`,
        steps: (heat) => ["Elekeza kamera ya simu kwenye msimbo huu na ufungue kiungo.", "Simu yako itaonyesha msimbo. Muonyeshe mfanyakazi wa shirika.", `${heat ? "Wimbi la joto" : "Mafuriko"} yakitabiriwa, fungua ukurasa tena na ubonyeze Dai.`],
        privacy: "Jina lako haliendi kamwe kwenye blockchain. Ni simu yako tu inayoweza kudai."
    }
}

/** ?lang= if we have it (the poster then carries English underneath), else English. */
export function posterLang(asked: string | null): string {
    const a = asked?.slice(0, 2).toLowerCase()
    return a && a in P ? a : "en"
}
