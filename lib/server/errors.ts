import "server-only";

export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function externalError(status: number, code?: unknown): AppError {
  if (status === 206 || code === "transcript-unavailable") {
    return new AppError(422, "NO_CAPTIONS", "Este vídeo não tem legendas disponíveis. Nenhuma transcrição será gerada.");
  }
  if (status === 402 || code === "upgrade-required" || code === "insufficient-credits") {
    return new AppError(402, "CREDITS_EXHAUSTED", "Os créditos ou o plano da Supadata não permitem esta extração. Consulte o responsável pela aplicação.");
  }
  if (status === 429 || code === "limit-exceeded") {
    return new AppError(429, "RATE_LIMITED", "Limite de solicitações atingido. Aguarde um pouco antes de tentar novamente.");
  }
  if ([403, 404].includes(status) || code === "not-found" || code === "forbidden") {
    return new AppError(422, "VIDEO_UNAVAILABLE", "O vídeo está indisponível, é privado ou tem restrições de acesso.");
  }
  if (status === 401 || code === "unauthorized") {
    return new AppError(503, "PROVIDER_CONFIG", "A integração com a Supadata precisa ser configurada pelo responsável pela aplicação.");
  }
  return new AppError(502, "UPSTREAM_ERROR", "Não foi possível consultar as legendas no serviço externo. Tente novamente mais tarde.");
}
