export interface ThreadMessage {
	authorName: string;
	text: string;
	isBot: boolean;
}

const MAX_MESSAGES = 20;
const MAX_CHARS = 4000;

export function buildThreadContext(
	messages: ThreadMessage[],
	botName?: string,
): string {
	if (messages.length === 0) {
		return "";
	}

	const label = botName ?? "Bot";

	// Apply 20-message limit first (keep most recent)
	let omittedByCount = 0;
	let kept = messages;
	if (messages.length > MAX_MESSAGES) {
		omittedByCount = messages.length - MAX_MESSAGES;
		kept = messages.slice(omittedByCount);
	}

	// Format each message
	const lines = kept.map((msg) => {
		const author = msg.isBot ? label : msg.authorName;
		return `[${author}] ${msg.text}`;
	});

	// Apply 4000-character limit (drop older messages first)
	// We measure only the message lines, not the header or omission prefix
	let totalChars = 0;
	let startIndex = lines.length - 1;
	for (let i = lines.length - 1; i >= 0; i--) {
		// +1 for the newline that separates messages
		const lineLen = lines[i].length + (i < lines.length - 1 ? 1 : 0);
		if (totalChars + lineLen > MAX_CHARS) {
			break;
		}
		totalChars += lineLen;
		startIndex = i;
	}

	const omittedByChars = startIndex;
	const finalLines = lines.slice(startIndex);
	const totalOmitted = omittedByCount + omittedByChars;

	const parts: string[] = ["Previous conversation:"];
	if (totalOmitted > 0) {
		parts.push(`[... ${totalOmitted} earlier messages omitted]`);
	}
	for (const line of finalLines) {
		parts.push(line);
	}

	return parts.join("\n");
}
