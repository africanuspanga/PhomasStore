import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";
import { getPhomasWhatsAppUrl, PHOMAS_WHATSAPP_DISPLAY } from "@/lib/contact";
import { CustomerOnboarding } from "@/components/CustomerOnboarding";

export function CustomerAssistance() {
  const whatsappUrl = getPhomasWhatsAppUrl();

  return (
    <>
      <div className="sticky top-16 z-30 border-b border-emerald-100 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div>
            <p className="text-sm font-semibold text-gray-900">Shopping assistance</p>
            <p className="text-xs text-gray-600">Phomas Diagnostics support is available on WhatsApp.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CustomerOnboarding />
            <Button
              asChild
              size="sm"
              className="h-9 bg-green-600 hover:bg-green-700"
              data-testid="button-whatsapp-assistance-top"
            >
              <a href={whatsappUrl} target="_blank" rel="noreferrer">
                <MessageCircle className="h-4 w-4 mr-2" />
                {PHOMAS_WHATSAPP_DISPLAY}
              </a>
            </Button>
          </div>
        </div>
      </div>

      <Button
        asChild
        size="icon"
        className="fixed bottom-5 right-5 z-50 h-12 w-12 rounded-full bg-green-600 shadow-lg hover:bg-green-700"
        data-testid="button-whatsapp-assistance-floating"
      >
        <a href={whatsappUrl} target="_blank" rel="noreferrer" aria-label="Contact Phomas Diagnostics on WhatsApp">
          <MessageCircle className="h-6 w-6" />
        </a>
      </Button>
    </>
  );
}
