"use client";

import { getImageUrl } from "@/utils/images";

export function useGetImageUrl() {
	return (documentId: string) =>
		getImageUrl(documentId, {
			baseUrl: "",
		});
}
