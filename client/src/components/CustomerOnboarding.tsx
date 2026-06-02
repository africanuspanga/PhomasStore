import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, ChevronLeft, ChevronRight, PlayCircle } from "lucide-react";

const STORAGE_KEY = "phomas_purchase_tour_seen";

const steps = [
  {
    title: "Choose products",
    text: "Browse the catalog and add the medicines or supplies you need.",
  },
  {
    title: "Review cart",
    text: "Confirm quantities, stock, payment method, delivery choice, and ice-pack needs.",
  },
  {
    title: "Submit order",
    text: "Place the order and keep the order number shown after checkout.",
  },
  {
    title: "Track progress",
    text: "Open Order History to check processing, ERP sync, and completion status.",
  },
];

export function CustomerOnboarding({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) {
      return;
    }

    const timer = window.setTimeout(() => setOpen(true), 600);
    return () => window.clearTimeout(timer);
  }, []);

  const closeTour = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setOpen(false);
  };

  const currentStep = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;

  return (
    <>
      <Button
        type="button"
        variant={compact ? "ghost" : "outline"}
        size="sm"
        onClick={() => {
          setStepIndex(0);
          setOpen(true);
        }}
        className={compact ? "h-9 px-2" : "h-9 border-phomas-green text-phomas-green hover:bg-green-50"}
        data-testid="button-open-customer-tour"
      >
        <PlayCircle className="h-4 w-4 mr-2" />
        How to Use
      </Button>

      <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? setOpen(true) : closeTour())}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-phomas-green">
              <PlayCircle className="h-5 w-5" />
              How to place an order
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div className="flex items-center gap-2">
              {steps.map((step, index) => (
                <div
                  key={step.title}
                  className={`h-2 flex-1 rounded-full ${index <= stepIndex ? "bg-phomas-green" : "bg-gray-200"}`}
                />
              ))}
            </div>

            <div className="rounded-lg border border-gray-200 p-5">
              <Badge variant="outline" className="mb-4">
                Step {stepIndex + 1} of {steps.length}
              </Badge>
              <h3 className="text-lg font-semibold text-gray-900">{currentStep.title}</h3>
              <p className="mt-2 text-sm leading-6 text-gray-600">{currentStep.text}</p>
            </div>

            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
                disabled={stepIndex === 0}
              >
                <ChevronLeft className="h-4 w-4 mr-2" />
                Back
              </Button>

              {isLastStep ? (
                <Button type="button" size="sm" onClick={closeTour} className="bg-phomas-green hover:bg-phomas-green/90">
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Finish
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setStepIndex((index) => Math.min(steps.length - 1, index + 1))}
                  className="bg-phomas-green hover:bg-phomas-green/90"
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
