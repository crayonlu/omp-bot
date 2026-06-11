/** REST helpers wrapping fetch. Base URL from env or relative. */

const BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
	const url = `${BASE}${path}`;
	const opts: RequestInit = {
		method,
		headers: { "Content-Type": "application/json" },
	};
	if (body !== undefined) {
		opts.body = JSON.stringify(body);
	}
	const res = await fetch(url, opts);
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`${method} ${path} ${res.status}: ${text}`);
	}
	return res.json() as Promise<T>;
}

export function get<T>(path: string): Promise<T> {
	return request<T>("GET", path);
}

export function post<T>(path: string, body?: unknown): Promise<T> {
	return request<T>("POST", path, body);
}

export function put<T>(path: string, body?: unknown): Promise<T> {
	return request<T>("PUT", path, body);
}

export function del<T>(path: string): Promise<T> {
	return request<T>("DELETE", path);
}
