import { GoogleGenAI, Type } from "@google/genai";

export const generateAlbumTracklist = async (artist: string, albumName: string): Promise<string[]> => {
  if (!process.env.API_KEY) {
    console.warn("No API Key available");
    return [];
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `List all the songs in the album "${albumName}" by artist "${artist}". Return only the song titles as a simple list. Do not include disc numbers or track numbers unless they are part of the title.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING
          }
        }
      }
    });

    const jsonStr = response.text;
    if (!jsonStr) return [];
    
    return JSON.parse(jsonStr) as string[];
  } catch (error) {
    console.error("Gemini API Error:", error);
    return [];
  }
};