// Only the upstream viewer surface used by our adapter. The pinned release is tested as a unit.
export interface PdfViewerApplication {
  initializedPromise: Promise<void>;
  initialBookmark: string | null;
  initialRotation?: number;
  pagesCount: number;
  page: number;
  pdfDocument: { numPages: number } | null;
  open(options: {
    data: Uint8Array;
    filename: string;
    isEvalSupported: boolean;
    useWorkerFetch: boolean;
  }): Promise<void>;
  close(): Promise<void>;
  eventBus: {
    on(name: string, listener: (event: ViewerEvent) => void): void;
  };
  pdfViewer: { currentScaleValue: string; pagesRotation: number };
}

export interface ViewerEvent {
  view?: number;
  source?: { canvas?: HTMLCanvasElement };
  pageNumber?: number;
  error?: unknown;
  location?: { left: number; top: number };
}

export interface PdfViewerWindow extends Window {
  PDFViewerApplication: PdfViewerApplication;
  PDFViewerApplicationOptions: { setAll(options: Record<string, unknown>): void };
}
