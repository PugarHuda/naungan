// Files a page hands to the visitor (audit exports, dedup exchange files and lists).

export function download(name: string, type: string, text: string) {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type })), download: name })
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** A CSV cell, always quoted; formula-looking text is prefixed so spreadsheets never execute it (CSV injection). */
export const cell = (v: unknown) => `"${String(v ?? "").replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`
