export const PHOMAS_WHATSAPP_NUMBER = "255755378111";
export const PHOMAS_WHATSAPP_DISPLAY = "+255 755 378 111";

export function getPhomasWhatsAppUrl(message = "Hello Phomas Diagnostics, I need assistance while shopping.") {
  return `https://wa.me/${PHOMAS_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
