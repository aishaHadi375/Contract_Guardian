
import { GoogleGenAI } from "@google/genai";
import { SYSTEM_INSTRUCTION } from "../constants";
import { ContractAnalysis } from "../types";

export interface AnalysisResponse {
  data: ContractAnalysis;
  latency: number;
}

export const analyzeContract = async (
  text: string,
  imageB64s: string[] = []
): Promise<AnalysisResponse> => {
  const startTime = performance.now();
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const parts: any[] = [
    { text: SYSTEM_INSTRUCTION },
    { text: `DOCUMENT TO ANALYZE:\n${text}` }
  ];
  
  imageB64s.forEach(b64 => {
    parts.push({
      inlineData: { data: b64, mimeType: "image/jpeg" }
    });
  });

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: { parts },
    config: {
      responseMimeType: "application/json",
      temperature: 0.1
    }
  });

  const endTime = performance.now();
  const rawText = response.text || "{}";
  const cleanJson = rawText.replace(/```json\n?|\n?```/g, "").trim();
  
  try {
    const data = JSON.parse(cleanJson);
    return {
      data,
      latency: Math.round(endTime - startTime)
    };
  } catch (e) {
    console.error("Failed to parse JSON:", cleanJson);
    throw new Error("Analysis failed to produce a valid report. Please try again.");
  }
};
