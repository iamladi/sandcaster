export interface NavItem {
	id: string;
	title: string;
	order: number;
}

export interface NavSection {
	title: string;
	items: NavItem[];
}

export function getDocsNavigation(): NavSection[] {
	return [
		{
			title: "Getting Started",
			items: [
				{ id: "getting-started", title: "Getting Started", order: 1 },
				{ id: "configuration", title: "Configuration", order: 2 },
			],
		},
		{
			title: "Reference",
			items: [
				{ id: "api-reference", title: "API Reference", order: 3 },
				{ id: "sdk-reference", title: "SDK Reference", order: 4 },
				{ id: "cli-reference", title: "CLI Reference", order: 5 },
			],
		},
		{
			title: "Guides",
			items: [
				{ id: "starters", title: "Starters", order: 6 },
				{ id: "deployment", title: "Deployment", order: 7 },
			],
		},
	];
}
