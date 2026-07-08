/// <reference types="@sveltejs/kit" />

declare global {
	namespace App {
		interface Locals {
			isAdmin: boolean;
		}
	}
}

export {};
