import { Button } from "@/components/ui/button";
import { getPhomasWhatsAppUrl } from "@/lib/contact";
import { CustomerOnboarding } from "@/components/CustomerOnboarding";
import { useLocation } from "wouter";

const WHATSAPP_FLOATING_ICON_SRC = "/whatsapp-floating.png";

export function CustomerAssistance() {
  const whatsappUrl = getPhomasWhatsAppUrl();
  const [location] = useLocation();
  const showTopAssistance = !location.startsWith("/cart");

  return (
    <>
      {showTopAssistance && (
        <div className="sticky top-16 z-30 border-b border-emerald-100 bg-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-1.5 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
              <p className="text-sm font-semibold text-gray-900">Shopping assistance</p>
              <p className="text-xs text-gray-600">Phomas Diagnostics support is available while you shop.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CustomerOnboarding compact />
            </div>
          </div>
        </div>
      )}

      <Button
        asChild
        size="icon"
        className="fixed bottom-5 right-5 z-50 h-14 w-14 overflow-hidden rounded-full bg-transparent p-0 shadow-lg hover:bg-transparent focus-visible:ring-green-600"
        data-testid="button-whatsapp-assistance-floating"
      >
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="Contact Phomas Diagnostics on WhatsApp"
          title="Contact Phomas Diagnostics on WhatsApp"
        >
          <img
            src={WHATSAPP_FLOATING_ICON_SRC}
            alt=""
            aria-hidden="true"
            className="h-full w-full rounded-full object-cover"
          />
        </a>
      </Button>
    </>
  );
}
