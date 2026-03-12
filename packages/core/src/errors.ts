export class SandcasterError extends Error {
	constructor(
		message: string,
		public readonly code?: string,
	) {
		super(message);
		this.name = "SandcasterError";
	}
}

export class AuthError extends SandcasterError {
	constructor(message: string) {
		super(message, "AUTH_ERROR");
		this.name = "AuthError";
	}
}

export class ValidationError extends SandcasterError {
	constructor(message: string) {
		super(message, "VALIDATION_ERROR");
		this.name = "ValidationError";
	}
}
