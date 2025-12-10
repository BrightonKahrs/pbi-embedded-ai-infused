import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  context?: string;
}

export interface ChatResponse {
  message: string;
  role: string;
}

export interface PowerBIConfig {
  embedUrl: string;
  accessToken: string;
  embedType: string;
}

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const apiService = {
  // Chat endpoints
  async sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
    const response = await apiClient.post<ChatResponse>('/api/chat', request);
    return response.data;
  },

  async getChatHistory(): Promise<{ messages: ChatMessage[] }> {
    const response = await apiClient.get('/api/chat/history');
    return response.data;
  },

  async clearChatHistory(): Promise<void> {
    await apiClient.delete('/api/chat/history');
  },

  // Power BI endpoints
  async getPowerBIConfig(): Promise<PowerBIConfig> {
    const response = await apiClient.get<PowerBIConfig>('/api/powerbi/config');
    return response.data;
  },

  // Health check
  async healthCheck(): Promise<any> {
    const response = await apiClient.get('/');
    return response.data;
  },
};
