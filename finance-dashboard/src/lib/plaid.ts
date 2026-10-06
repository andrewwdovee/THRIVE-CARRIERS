import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from "plaid";

let client: PlaidApi | null = null;

export function plaidConfigured(): boolean {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

export function plaid(): PlaidApi {
  if (!plaidConfigured()) throw new Error("PLAID_CLIENT_ID and PLAID_SECRET are not set");
  if (!client) {
    const env = (process.env.PLAID_ENV || "sandbox") as keyof typeof PlaidEnvironments;
    client = new PlaidApi(
      new Configuration({
        basePath: PlaidEnvironments[env] ?? PlaidEnvironments.sandbox,
        baseOptions: {
          headers: {
            "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!,
            "PLAID-SECRET": process.env.PLAID_SECRET!,
          },
        },
      }),
    );
  }
  return client;
}

export const LINK_PRODUCTS = [Products.Transactions];
export const LINK_OPTIONAL_PRODUCTS = [Products.Investments];

export function countryCodes(): CountryCode[] {
  return (process.env.PLAID_COUNTRY_CODES || "US")
    .split(",")
    .map((c) => c.trim().toUpperCase() as CountryCode)
    .filter(Boolean);
}

/** Pull a readable message out of a Plaid/axios error. */
export function plaidErrorMessage(err: unknown): { code?: string; message: string } {
  const e = err as { response?: { data?: { error_code?: string; error_message?: string } }; message?: string };
  const data = e?.response?.data;
  if (data?.error_code) return { code: data.error_code, message: `${data.error_code}: ${data.error_message}` };
  return { message: e?.message || String(err) };
}
