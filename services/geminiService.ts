
import { GoogleGenAI, Type } from "@google/genai";
import { AiParsedExpense, Expense, ExpenseCategory, TripMetadata } from "../types";

// Initialize Gemini client lazily to avoid crashing the app when no API key is set.
let aiClient: GoogleGenAI | null = null;
const getAiClient = () => {
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY (set it in .env.local) to use AI features.");
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
};

// Strict DD/MM/YYYY formatter
const formatDate = (dateStr: string | null) => {
  if (!dateStr) return 'N/A';
  // Check if it's ISO datetime
  if (dateStr.includes('T')) {
      const d = new Date(dateStr);
      return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', {hour: '2-digit', minute:'2-digit'});
  }
  const parts = dateStr.split('-');
  if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
};

/**
 * Extract expense data from a receipt image.
 */
export const parseReceiptImage = async (base64Image: string): Promise<AiParsedExpense> => {
  try {
    // Strip prefix if present (e.g., "data:image/jpeg;base64,")
    const cleanBase64 = base64Image.split(',')[1] || base64Image;
    const mimeType = base64Image.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/)?.[1] || 'image/jpeg';

    const prompt = `
      Analyze this receipt. Extract the following fields:
      - date (YYYY-MM-DD format)
      - amount (number)
      - currency (string code like EUR, USD)
      - location (City, Country if available, or Merchant Name)
      - category (Must be exactly one of: Meals, Hotel, Taxi, Transport, Parking, Fuel, Tolls, Misc)
      
      IF Category is 'Hotel':
      - hotelNights (integer): Number of nights stayed. Look for "Nights", "Nächte", or quantity. Default to 1 if unsure but it looks like a night stay.
      - hotelBreakfasts (integer): Number of breakfasts charged. Look for "Breakfast", "Frühstück". Default to 0 if not found.
    `;

    // Use gemini-3-flash-preview for the task and configure responseSchema for JSON output.
    const response = await getAiClient().models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { mimeType: mimeType, data: cleanBase64 } },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            date: { type: Type.STRING },
            amount: { type: Type.NUMBER },
            currency: { type: Type.STRING },
            location: { type: Type.STRING },
            category: { type: Type.STRING },
            hotelNights: { type: Type.INTEGER },
            hotelBreakfasts: { type: Type.INTEGER }
          }
        }
      }
    });

    if (response.text) {
      // response.text directly returns the string output; no need to call text()
      return JSON.parse(response.text.trim()) as AiParsedExpense;
    }
    throw new Error("No response text from AI");

  } catch (error) {
    console.error("Gemini OCR Error:", error);
    throw error;
  }
};

/**
 * Generate a formal reimbursement request email.
 */
export const generateReimbursementEmail = async (trip: TripMetadata, expenses: Expense[]): Promise<{ subject: string, body: string }> => {
  const currency = expenses[0]?.currency || 'EUR';
  
  // Determine date range using the new specific fields or fallback to expense dates
  const startDateStr = trip.departureDate ? formatDate(trip.departureDate) : formatDate(expenses[0]?.date);
  const endDateStr = trip.returnDate ? formatDate(trip.returnDate) : formatDate(expenses[expenses.length-1]?.date);
  const startLocation = trip.departureLocation || 'Non spécifié';
  const destination = trip.destinationCountry || 'Non spécifié (Déduit des frais)';

  // Format dates for the list using strict DD/MM/YYYY and include details for Hotels
  const expenseList = expenses.map(e => {
    let details = `${formatDate(e.date)} | ${e.category} | ${e.location} | ${e.amount} ${e.currency}`;
    if (e.category === 'Hotel') {
      details += ` (Détails: ${e.hotelNights || 0} Nuits, ${e.hotelBreakfasts || 0} Petits-déjeuners)`;
    }
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
    - Applique la déduction de 20% du forfait journalier complet pour chaque petit-déjeuner noté (champ "Petits-déjeuners" > 0 dans les dépenses ou inclus dans l'hôtel).

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
    - Ne mets pas de texte avant ou après ce modèle.
    - Si une catégorie (Hôtel ou Carburant) est vide (0€), ne l'affiche pas dans la liste.
    - Sois précis sur les calculs.
  `;

  try {
    // Use gemini-3-flash-preview and provide responseSchema for structured JSON output.
    const response = await getAiClient().models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: { parts: [{ text: prompt }] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            body: { type: Type.STRING }
          },
          required: ["subject", "body"]
        }
      }
    });

    if (response.text) {
        // Access response.text directly (property, not method)
        return JSON.parse(response.text.trim());
    }
    throw new Error("No text generated");

  } catch (error) {
    console.error("Gemini Email Gen Error:", error);
    return {
      subject: "Demande de remboursement - Frais de déplacement",
      body: "Erreur lors de la génération de l'email. Veuillez vérifier votre connexion ou réessayer."
    };
  }
};
