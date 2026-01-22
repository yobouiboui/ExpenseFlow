
export enum ExpenseCategory {
  Meals = 'Meals',
  Hotel = 'Hotel',
  Taxi = 'Taxi',
  Transport = 'Transport',
  Parking = 'Parking',
  Fuel = 'Fuel',
  Tolls = 'Tolls',
  Misc = 'Misc',
}

export enum ExpenseStatus {
  Draft = 'Draft',
  Submitted = 'Submitted',
  Validated = 'Validated',
}

export interface Expense {
  id: string;
  tripId: string;
  date: string; // ISO string YYYY-MM-DD
  category: ExpenseCategory;
  location: string;
  amount: number;
  currency: string;
  status: ExpenseStatus;
  receiptDataUrl?: string; // Base64 string for the image
  description?: string;
  // Hotel specific fields
  hotelNights?: number;
  hotelBreakfasts?: number;
}

export interface TripMetadata {
  id: string;
  startDateManual: string | null;
  endDateManual: string | null;
  status: 'active' | 'archived';
  name: string;
  // New fields for specific trip details
  departureLocation?: string;
  destinationCountry?: string; // New field
  departureDate?: string; // ISO datetime
  returnDate?: string; // ISO datetime
}

export interface EmailDraft {
  subject: string;
  body: string;
}

export interface AiParsedExpense {
  date?: string;
  amount?: number;
  currency?: string;
  location?: string;
  category?: ExpenseCategory;
  hotelNights?: number;
  hotelBreakfasts?: number;
}

export interface ArchivedTrip {
  id: string;
  trip: TripMetadata;
  expenses: Expense[];
  archivedAt: string;
}
