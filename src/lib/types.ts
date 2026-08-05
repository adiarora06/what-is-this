export type PurchaseLink = {
  label: string;
  url: string;
};

export type IdentificationProvider = "auto" | "device" | "gemini" | "classifier";

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
  shoppingRecommended: boolean;
  verified?: boolean;
  safetyNote?: string;
  source?: string;
  storagePath?: string;
  correctedFrom?: string;
  detections?: Array<{ label: string; confidence: number; bbox: number[] }>;
  alternatives?: Array<{ label: string; confidence: number; source?: string }>;
  barcode?: string;
  recognizedText?: string[];
  tags?: string[];
  favorite?: boolean;
  visualSignature?: number[];
  learnedCorrection?: {
    catalogEntryId: string;
    originalObjectName: string;
    originalShortName: string;
    originalCategory: string;
    originalAbout: string;
    originalPurchaseQuery: string;
    originalPurchaseLinks: PurchaseLink[];
    originalShoppingRecommended: boolean;
    originalVisualClues: string[];
  };
};

export type StoryboardBoard = {
  id: string;
  name: string;
  createdAt: string;
  items: ObjectCard[];
};

export type AccuracyFeedback = {
  id: string;
  createdAt: string;
  predictedName: string;
  correctedName?: string;
  category: string;
  confidence: number;
  source: string;
  wasCorrect: boolean;
  image?: string;
  storagePath?: string;
};

export type CatalogEntry = {
  id: string;
  createdAt: string;
  updatedAt: string;
  objectName: string;
  category: string;
  notes: string;
  matchLabels: string[];
  fingerprint?: string;
  visualSignature?: number[];
  image?: string;
};

export type IdentifyResponse =
  | {
      ok: true;
      card: Omit<ObjectCard, "id" | "createdAt" | "image" | "purchaseLinks"> & {
        purchaseLinks?: PurchaseLink[];
      };
      model: string;
      provider: string;
      warnings?: string[];
      requestId?: string;
    }
  | {
      ok: false;
      error: string;
      requestId?: string;
    };
