/** A label as the LLM sees it — scope and name are separate, color is #-prefixed. */
export interface Label {
	name: string;
	scope?: string;
	color?: string;
	description?: string;
	/** Whether this scope is exclusive (only one label per scope allowed). Forgejo-specific. */
	exclusive?: boolean;
}

/** Supported backend types. */
export type BackendType = "github" | "forgejo" | "gitlab" | "local";

/** An issue as it flows through the extension. */
export interface Issue {
	number: number;
	title: string;
	body: string;
	state: "open" | "closed";
	labels: Label[];
	assignee: string | null;
	parent: number | null;
	blocked_by: number[];
	created_at: string;
	updated_at: string;
	url: string;
	/** Only populated by get_issue, not list_issues. */
	comments?: Comment[];
}

/** A comment on an issue. */
export interface Comment {
	id: string;
	author: string;
	body: string;
	created_at: string;
}

/** Auth configuration stored in ~/.pi/agent/issue-tracker-auth.json */
export interface AuthConfig {
	github?: {
		token: string;
	};
	forgejo?: Record<
		string,
		{
			token: string;
			instance_url: string;
		}
	>;
	gitlab?: Record<
		string,
		{
			token: string;
			instance_url: string;
		}
	>;
	local?: {
		username: string;
	};
}

/** Resolved backend configuration for the current repo. */
export interface BackendConfig {
	type: BackendType;
	/** Owner of the repo (GitHub/Forgejo) */
	owner: string;
	/** Repo name (GitHub/Forgejo) */
	repo: string;
	/** Base URL of the instance, e.g. "https://api.github.com" or "https://codeberg.org" */
	instanceUrl: string;
	/** For local backend: path to the docs/issues directory */
	issuesPath?: string;
}

/** Parameters for creating an issue. */
export interface CreateIssueParams {
	title: string;
	body?: string;
	labels?: Label[];
	parent?: number;
	assignee?: string;
}

/** Parameters for listing issues. */
export interface ListIssuesParams {
	state?: "open" | "closed" | "all";
	labels?: Label[];
	assignee?: "@me" | "@unassigned" | string;
	unblocked?: boolean;
	parent?: number;
	limit?: number;
}

/** Parameters for updating an issue. */
export interface UpdateIssueParams {
	issue_number: number;
	title?: string;
	body?: string;
	state?: "open" | "closed";
	labels?: Label[];
	label_mode?: "replace" | "add" | "remove";
	assignee?: string | null;
	blocked_by?: number[];
}

/** Parameters for creating a label. */
export interface CreateLabelParams {
	name: string;
	scope?: string;
	color?: string;
	description?: string;
	exclusive?: boolean;
}

/** Parameters for updating a label. */
export interface UpdateLabelParams {
	name: string;
	scope?: string;
	new_name?: string;
	new_scope?: string;
	color?: string;
	description?: string;
	exclusive?: boolean;
}

/** Parameters for deleting a label. */
export interface DeleteLabelParams {
	name: string;
	scope?: string;
}

/** Parameters for getting an issue. */
export interface GetIssueParams {
	issue_number: number;
	include_comments?: boolean;
}

/** Parameters for commenting on an issue. */
export interface CommentIssueParams {
	issue_number: number;
	body: string;
}

/** Parameters for listing labels. */
export interface ListLabelsParams {
	scope?: string;
}

/** Token/credential info for remote backends. */
export interface TokenInfo {
	token?: string;
	instanceUrl?: string;
	username?: string;
}

/** Registration record for a backend — used by the registry to auto-detect and wire up. */
export interface BackendRegistration {
	type: BackendType;
	backend: Backend;
	/** Returns true if this backend can handle the given git host. */
	detect: (host: string) => boolean;
	/** Resolve auth token for this backend from the stored config. */
	resolveToken: (auth: AuthConfig, config: BackendConfig) => TokenInfo | null;
}

/** The backend interface that all forges implement. */
export interface Backend {
	createIssue(
		params: CreateIssueParams,
		config: BackendConfig,
		token?: TokenInfo,
	): Promise<Issue>;
	listIssues(
		params: ListIssuesParams,
		config: BackendConfig,
		token?: TokenInfo,
	): Promise<Issue[]>;
	getIssue(
		params: GetIssueParams,
		config: BackendConfig,
		token?: TokenInfo,
	): Promise<Issue>;
	updateIssue(
		params: UpdateIssueParams,
		config: BackendConfig,
		token?: TokenInfo,
	): Promise<Issue>;
	commentIssue(
		params: CommentIssueParams,
		config: BackendConfig,
		token?: TokenInfo,
	): Promise<Comment>;
	listLabels(
		params: ListLabelsParams,
		config: BackendConfig,
		token?: TokenInfo,
	): Promise<Label[]>;
	createLabel(
		params: CreateLabelParams,
		config: BackendConfig,
		token?: TokenInfo,
	): Promise<Label>;
	updateLabel(
		params: UpdateLabelParams,
		config: BackendConfig,
		token?: TokenInfo,
	): Promise<Label>;
	deleteLabel(
		params: DeleteLabelParams,
		config: BackendConfig,
		token?: TokenInfo,
	): Promise<void>;
}
