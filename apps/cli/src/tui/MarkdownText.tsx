import { Text, useStdoutDimensions } from "ink";
import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { useMemo } from "react";

export function stripIncompleteInline(text: string): string {
	return text.replace(/(?<=\s|^)(\*{1,3}|`{1,3}|_{1,2})\s*$/, "");
}

interface MarkdownTextProps {
	content: string;
	streaming?: boolean;
}

export function MarkdownText({
	content,
	streaming,
}: MarkdownTextProps): React.ReactElement {
	const [columns] = useStdoutDimensions();

	const rendered = useMemo(() => {
		if (!content) return "";
		const text = streaming ? stripIncompleteInline(content) : content;
		const md = new Marked().use(markedTerminal({ width: columns }));
		const result = md.parse(text) as string;
		return result.replace(/\n+$/, "");
	}, [content, columns, streaming]);

	if (!rendered) return <Text>{""}</Text>;
	return <Text>{rendered}</Text>;
}
