// qrcode ships no types; the claim app only calls toString(text, options) → SVG markup.
declare module "qrcode" {
    const QRCode: { toString(text: string, options: Record<string, unknown>): Promise<string> }
    export default QRCode
}
