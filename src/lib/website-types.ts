export type WebsiteVerifyStatus = 'pending' | 'live' | 'parked' | 'dead' | 'error';

/** Client-safe website card shape (mirrors candidate_domains live rows). */
export interface WebsiteCardModel {
	registrable_domain: string;
	source_ct: number;
	source_zone: number;
	first_seen_at: string;
	verified_at: string | null;
	http_status: number | null;
	final_url: string | null;
	page_title: string | null;
	verify_status: WebsiteVerifyStatus;
	rating_avg?: number | null;
	rating_count?: number;
	favorite_count?: number;
	category?: string | null;
	summary?: string | null;
	quality_score?: number | null;
}
