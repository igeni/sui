// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Output } from 'valibot';
import { parse, safeParse } from 'valibot';

import { withResolvers } from '../utils/withResolvers.js';
import type { ZkSendRequestTypes, ZkSendResponsePayload, ZkSendResponseTypes } from './events.js';
import { ZkSendRequest, ZkSendResponse } from './events.js';

export const DEFAULT_ZKSEND_ORIGIN = 'https://zksend.com';

interface ZkSendPopupOptions {
	origin?: string;
	name: string;
}

export class ZkSendPopup {
	#id: string;
	#origin: string;
	#name: string;

	#close?: () => void;

	constructor({ origin = DEFAULT_ZKSEND_ORIGIN, name }: ZkSendPopupOptions) {
		this.#id = crypto.randomUUID();
		this.#origin = origin;
		this.#name = name;
	}

	async createRequest<T extends keyof ZkSendResponseTypes>(
		type: T,
		data: ZkSendRequestTypes[T],
	): Promise<ZkSendResponseTypes[T]> {
		const { promise, resolve, reject } = withResolvers<ZkSendResponseTypes[T]>();

		let popup: Window | null = null;

		const listener = (event: MessageEvent) => {
			if (event.origin !== this.#origin) {
				return;
			}
			const { success, output } = safeParse(ZkSendResponse, event.data);
			if (!success || output.id !== this.#id) return;

			window.removeEventListener('message', listener);

			if (output.payload.type === 'reject') {
				reject(new Error('User rejected the request'));
			} else if (output.payload.type === 'resolve') {
				resolve(output.payload.data as ZkSendResponseTypes[T]);
			}
		};

		this.#close = () => {
			popup?.close();
			window.removeEventListener('message', listener);
		};

		window.addEventListener('message', listener);

		popup = window.open(
			`${this.#origin}/dapp/${type}?${new URLSearchParams({
				id: this.#id,
				origin: window.origin,
				name: this.#name,
			})}${data ? `#${new URLSearchParams(data)}` : ''}`,
		);

		if (!popup) {
			throw new Error('Failed to open zkSend window');
		}

		return promise;
	}

	close() {
		this.#close?.();
	}
}

export class ZkSendHost {
	#request: Output<typeof ZkSendRequest>;

	constructor(request: Output<typeof ZkSendRequest>) {
		if (typeof window === 'undefined' || !window.opener) {
			throw new Error(
				'ZkSendHost can only be used in a window opened through `window.open`. `window.opener` is not available.',
			);
		}

		this.#request = request;
	}

	static fromUrl(url: string = window.location.href) {
		const parsed = new URL(url);

		const request = parse(ZkSendRequest, {
			id: parsed.searchParams.get('id'),
			origin: parsed.searchParams.get('origin'),
			name: parsed.searchParams.get('name'),
			type: parsed.pathname.split('/').pop(),
			data: parsed.hash ? Object.fromEntries(new URLSearchParams(parsed.hash.slice(1))) : {},
		});

		return new ZkSendHost(request);
	}

	getRequestData() {
		return this.#request;
	}

	sendMessage(payload: ZkSendResponsePayload) {
		window.opener.postMessage(
			{
				id: this.#request.id,
				source: 'zksend-channel',
				payload,
			} satisfies ZkSendResponse,
			this.#request.origin,
		);
	}
}
