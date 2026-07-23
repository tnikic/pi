import { formatLabel, parseLabel } from "../labels.ts";
import type { Label } from "../types.ts";

/** Parse a labels.md table into structured Label objects. */
export function parseLabelsTable(content: string): Label[] {
	const labels: Label[] = [];
	const lines = content.split("\n");

	let inTable = false;
	for (const line of lines) {
		if (line.startsWith("| Name ")) {
			inTable = true;
			continue;
		}
		if (inTable && line.startsWith("|---")) continue;
		if (inTable && line.startsWith("| ")) {
			const rawCols = line.split("|").map((c) => c.trim());
			if (rawCols[0] === "") rawCols.shift();
			if (rawCols[rawCols.length - 1] === "") rawCols.pop();
			const cols = rawCols;
			const rawName = cols[0];
			if (cols.length >= 2 && rawName && rawName !== "Name") {
				const parsed = parseLabel(rawName, "local");
				labels.push({
					name: parsed.name,
					scope: parsed.scope,
					color: cols[1] || undefined,
					description: cols[2] || undefined,
					exclusive: cols[3] ? true : undefined,
				});
			}
		}
	}

	return labels;
}

/** Format labels as a markdown table. */
export function labelsTable(labels: Label[]): string {
	const header = "| Name | Color | Description | Exclusive Scope |";
	const sep = "|------|-------|-------------|-----------------|";
	const rows = labels.map(labelRow);
	return `${[header, sep, ...rows].join("\n")}\n`;
}

export function labelRow(label: Label): string {
	const displayName = formatLabel(label, "local");
	const color = label.color ?? "";
	const desc = label.description ?? "";
	const exclusive = label.exclusive ? (label.scope ?? label.name) : "";
	return `| ${displayName} | ${color} | ${desc} | ${exclusive} |`;
}
