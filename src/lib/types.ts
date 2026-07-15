export type PurchaseLink = {
  label: string;
  url: string;
};

export type ObjectCard = {
  id: string;
  createdAt: string;
  image: string;
  objectName: string;
  shortName: string;
  confidence: number;
  category: string;
  about: string;
  visualClues: string[];
  useCases: string[];
  careTips: string[];
  purchaseQuery: string;
  purchaseLinks: PurchaseLink[];
  safetyNote?: string;
  source?: string;
  correctedFrom?: string;
  detections?: Array<{ label: string; confidence: number; bbox: number[] }>;
  alternatives?: Array<{ label: string; confidence: number; source?: string }>;
};

export type CatalogEntry = {
  id: string;
  createdAt: string;
  updatedAt: string;
  objectName: string;
  category: string;
  notes: string;
  matchLabels: string[];
  image?: string;
};

export type IdentifyResponse =
  | {
      ok: true;
      card: Omit<ObjectCard, "id" | "createdAt" | "image" | "purchaseLinks"> & {
        purchaseLinks?: PurchaseLink[];
      };
      model: string;
    }
  | {
      ok: false;
      error: string;
    };

