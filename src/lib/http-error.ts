export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function httpErrorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  throw error;
}
