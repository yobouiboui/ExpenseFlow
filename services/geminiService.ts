
import { GoogleGenAI, Type } from "@google/genai";
import { AiParsedExpense, Expense, ExpenseCategory, TripMetadata } from "../types";

// ── localStorage keys ───────────────────────────────────────────────────────
const LS_KEY_GEMINI   = 'expenseFlow_gemini_key';
const LS_KEY_OPENAI   = 'expenseFlow_openai_key';
const LS_KEY_PROVIDER = 'expenseFlow_ai_provider';   // 'gemini' | 'openai'
const LS_KEY_MODEL    = 'expenseFlow_ai_model';

// ── Defaults ─────────────────────────────────────────────────────────────────
export const DEFAULT_PROVIDER = 'gemini';
export const DEFAULT_MODEL_GEMINI = 'gemini-2.5-flash';
export const DEFAULT_MODEL_OPENAI = 'gpt-4o';

// ── Getters / Setters ─────────────────────────────────────────────────────────
export function getStoredGeminiKey(): string  { return localStorage.getItem(LS_KEY_GEMINI)   || ''; }
export function getStoredOpenAIKey(): string  { return localStorage.getItem(LS_KEY_OPENAI)   || ''; }
export function getStoredProvider():  string  { return localStorage.getItem(LS_KEY_PROVIDER) || DEFAULT_PROVIDER; }
export function getStoredModel():     string  {
  const saved = localStorage.getItem(LS_KEY_MODEL);
  if (saved) return saved;
  return getStoredProvider() === 'openai' ? DEFAULT_MODEL_OPENAI : DEFAULT_MODEL_GEMINI;
}

export function saveGeminiKey(key: string): void {
  if (key.trim()) localStorage.setItem(LS_KEY_GEMINI, key.trim());
  else localStorage.removeItem(LS_KEY_GEMINI);
  aiClient = null;
}
export function saveOpenAIKey(key: string): void {
  if (key.trim()) localStorage.setItem(LS_KEY_OPENAI, key.trim());
  else localStorage.removeItem(LS_KEY_OPENAI);
}
export function saveProvider(provider: string): void {
  localStorage.setItem(LS_KEY_PROVIDER, provider);
  // Reset model to matching default when provider changes
  localStorage.removeItem(LS_KEY_MODEL);
  aiClient = null;
}
export function saveModel(model: string): void {
  if (model.trim()) localStorage.setItem(LS_KEY_MODEL, model.trim());
  else localStorage.removeItem(LS_KEY_MODEL);
}

// ── Gemini client (lazy) ──────────────────────────────────────────────────────
let aiClient: GoogleGenAI | null = null;
const getGeminiClient = () => {
  const apiKey = localStorage.getItem(LS_KEY_GEMINI) || process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Clé API Gemini manquante. Renseigne-la dans Paramètres → IA.");
  if (!aiClient) aiClient = new GoogleGenAI({ apiKey });
  return aiClient;
};

// ── Date formatter ────────────────────────────────────────────────────────────
const formatDate = (dateStr: string | null) => {
  if (!dateStr) return 'N/A';
  if (dateStr.includes('T')) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  const parts = dateStr.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateStr;
};

// ── OpenAI helper (raw fetch – no SDK needed) ─────────────────────────────────
async function callOpenAI(model: string, messages: object[]): Promise<string> {
  const apiKey = localStorage.getItem(LS_KEY_OPENAI);
  if (!apiKey) throw new Error("Clé API OpenAI manquante. Renseigne-la dans Paramètres → IA.");
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, response_format: { type: 'json_object' } }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } }).error?.message || `OpenAI error ${res.status}`);
  }
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content;
}

// ── parseReceiptImage ─────────────────────────────────────────────────────────
export const parseReceiptImage = async (base64Image: string): Promise<AiParsedExpense> => {
  const provider = getStoredProvider();
  const model    = getStoredModel();

  const cleanBase64 = base64Image.split(',')[1] || base64Image;
  const mimeType    = base64Image.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/)?.[1] || 'image/jpeg';
  const isPdf       = mimeType === 'application/pdf';

  const schemaDescription = `First decide if the document is a receipt, invoice, travel ticket, hotel folio, taxi receipt, parking receipt, fuel receipt, toll receipt, or other expense proof.
If it is not an expense proof, return {"isReceipt": false, "confidence": 0}.
Do not invent expense data from descriptive text, itineraries, emails, terms, or unrelated documents.
If it is an expense proof, return a JSON object with fields:
- isReceipt (boolean true)
- confidence (number from 0 to 1)
- date (string YYYY-MM-DD)
- amount (number)
- currency (string code e.g. EUR, USD)
- location (string: City, Country or Merchant Name)
- category (one of exactly: Meals, Hotel, Taxi, Transport, Parking, Fuel, Tolls, Misc)
- hotelNights (integer, relevant if category is Hotel)
- hotelBreakfasts (integer, relevant if category is Hotel)`;

  try {
    if (provider === 'openai') {
      const imageContent = isPdf
        ? [{ type: 'text', text: 'This is a PDF receipt. ' + schemaDescription }]
        : [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${cleanBase64}` } },
            { type: 'text', text: schemaDescription },
          ];
      const raw = await callOpenAI(model, [{ role: 'user', content: imageContent }]);
      return JSON.parse(raw) as AiParsedExpense;
    }

    // ── Gemini ───────────────────────────────────────────────────────────────
    const prompt = `Analyze this receipt. ${schemaDescription}
If category is Hotel: hotelNights = nights stayed (default 1), hotelBreakfasts = breakfasts charged (default 0).`;
    const response = await getGeminiClient().models.generateContent({
      model,
      contents: { parts: [{ inlineData: { mimeType, data: cleanBase64 } }, { text: prompt }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            date:             { type: Type.STRING },
            isReceipt:        { type: Type.BOOLEAN },
            confidence:       { type: Type.NUMBER },
            amount:           { type: Type.NUMBER },
            currency:         { type: Type.STRING },
            location:         { type: Type.STRING },
            category:         { type: Type.STRING },
            hotelNights:      { type: Type.INTEGER },
            hotelBreakfasts:  { type: Type.INTEGER },
          }
        }
      }
    });
    if (response.text) return JSON.parse(response.text.trim()) as AiParsedExpense;
    throw new Error("No response text from AI");
  } catch (error) {
    console.error("AI OCR Error:", error);
    throw error;
  }
};

// ── generateReimbursementEmail ────────────────────────────────────────────────
export const generateReimbursementEmail = async (
  trip: TripMetadata,
  expenses: Expense[]
): Promise<{ subject: string; body: string }> => {
  const provider  = getStoredProvider();
  const model     = getStoredModel();
  const currency  = expenses[0]?.currency || 'EUR';
  const startDateStr  = trip.departureDate ? formatDate(trip.departureDate) : formatDate(expenses[0]?.date);
  const endDateStr    = trip.returnDate    ? formatDate(trip.returnDate)    : formatDate(expenses[expenses.length - 1]?.date);
  const startLocation = trip.departureLocation || 'Non spécifié';
  const destination   = trip.destinationCountry || 'Non spécifié (Déduit des frais)';

  const expenseList = expenses.map(e => {
    let details = `${formatDate(e.date)} | ${e.category} | ${e.location} | ${e.amount} ${e.currency}`;
    if (e.category === 'Hotel') details += ` (Détails: ${e.hotelNights || 0} Nuits, ${e.hotelBreakfasts || 0} Petits-déjeuners)`;
    return details;
  }).join('\n');

  const prompt = `
Rôle : Agis en tant qu'expert en comptabilité de voyage allemande (Reisekostenabrechnung).

DONNÉES DU SUIVI DE FRAIS (CONTEXTE) :
- Ville de destination : ${destination}
- Départ : ${startLocation} le ${startDateStr}
- Retour : le ${endDateStr}
- Tableau des dépenses saisies :
${expenseList}

Tâche : Rédige l'email de demande de remboursement pour Sandrine en suivant STRICTEMENT le modèle ci-dessous.

Instructions de calcul (Indemnités Repas / Verpflegungsmehraufwand) : 
- Calcule le forfait BMF 2024 pour le pays de destination (${destination}).
- Applique la déduction de 20% du forfait journalier complet pour chaque petit-déjeuner noté.

FORMAT DE L'EMAIL (Output attendu) :

Objet : Demande de remboursement – Déplacement professionnel à [Destination] ([Dates])

Bonjour Sandrine,
Veuillez trouver ci-joint ma demande de remboursement relative à ma mission effectuée à [Destination] du [Date début] au [Date fin].

Récapitulatif du déplacement :
- Départ : [Ville Départ] le [Date] à [Heure].
- Retour : le [Date] à [Heure].
- Lieu de mission : [Destination], [Pays].

Frais à rembourser :
- Ligne Hôtel ([Nombre] nuits, [Nom Hôtel]) : [Montant] EUR.
- Ligne Carburant / Transport ([Nom Prestataires]) : [Montant] EUR.
- Ligne Repas (Forfait BMF [Pays] [Montant Forfait Brut] EUR, déduction de [Nb] petits-déjeuners à [Montant Unitaire Déduction] EUR soit [Total Déduction] EUR) : [Montant Net Indemnité] EUR.

**Total à rembourser : [Somme Totale] EUR**.

Ce calcul a été effectué en stricte conformité avec les barèmes du BMF Schreiben du 21.11.2023.
L'ensemble des justificatifs est annexé à cet envoi.

Signature : Yohan Bouyssiere.

Contraintes :
- Retourne UNIQUEMENT un JSON avec les champs "subject" et "body".
- Si une catégorie (Hôtel ou Carburant) est vide (0€), ne l'affiche pas dans la liste.
- Sois précis sur les calculs.
`;

  try {
    if (provider === 'openai') {
      const raw = await callOpenAI(model, [{ role: 'user', content: prompt }]);
      return JSON.parse(raw);
    }

    // ── Gemini ───────────────────────────────────────────────────────────────
    const response = await getGeminiClient().models.generateContent({
      model,
      contents: { parts: [{ text: prompt }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { subject: { type: Type.STRING }, body: { type: Type.STRING } },
          required: ["subject", "body"]
        }
      }
    });
    if (response.text) return JSON.parse(response.text.trim());
    throw new Error("No text generated");
  } catch (error) {
    console.error("AI Email Gen Error:", error);
    return {
      subject: "Demande de remboursement - Frais de déplacement",
      body: "Erreur lors de la génération de l'email. Veuillez vérifier votre connexion ou réessayer."
    };
  }
};
