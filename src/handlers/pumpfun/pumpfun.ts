import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { HttpsProxyAgent } from 'https-proxy-agent';

export interface PumpFunTokenOptions {
  twitter?: string;
  telegram?: string;
  website?: string;
  initialBuyAmount?: number;
  slippageBps?: number;
  priorityFee?: number;
}

async function uploadMetadata(
  tokenName: string,
  tokenTicker: string,
  description: string,
  imageUrl: string,
  options?: PumpFunTokenOptions,
): Promise<any> {
  // Create metadata object
  const formData = new URLSearchParams();
  formData.append("name", tokenName);
  formData.append("symbol", tokenTicker);
  formData.append("description", description);

  formData.append("showName", "true");

  if (options?.twitter) {
    formData.append("twitter", options.twitter);
  }
  if (options?.telegram) {
    formData.append("telegram", options.telegram);
  }
  if (options?.website) {
    formData.append("website", options.website);
  }

  let imageBlob;
  try {
    const imageResponse = await fetch(imageUrl);
    imageBlob = await imageResponse.blob();
  } catch (error) {
    throw new Error(`Failed to fetch image: ${error}`);
  }
  const files = {
    file: new File([imageBlob], "token_image.png", { type: "image/png" }),
  };

  // Create form data with both metadata and file
  const finalFormData = new FormData();
  // Add all metadata fields
  for (const [key, value] of formData.entries()) {
    finalFormData.append(key, value);
  }
  // Add file if exists
  if (files?.file) {
    finalFormData.append("file", files.file);
  }

  const fetchOptions: RequestInit & { agent?: HttpsProxyAgent<string> } = {
    method: "POST",
    body: finalFormData,
    agent: process.env.IPFS_HTTP_PROXY ? new HttpsProxyAgent(process.env.IPFS_HTTP_PROXY) : undefined,
  };

  let metadataResponse;
  try {
    metadataResponse = await fetch("https://pump.fun/api/ipfs", fetchOptions);
  } catch (error) {
    throw new Error(`Failed to upload metadata: ${error}`);
  }

  if (!metadataResponse.ok) {
    throw new Error(`Metadata upload failed: ${metadataResponse.statusText}`);
  }

  return await metadataResponse.json();
}

async function createTokenTransaction(
  publicKey: string,
  mintKeypair: Keypair,
  metadataResponse: any,
  options?: PumpFunTokenOptions,
) {
  const payload = {
    publicKey,
    action: "create",
    tokenMetadata: {
      name: metadataResponse.metadata.name,
      symbol: metadataResponse.metadata.symbol,
      uri: metadataResponse.metadataUri,
    },
    mint: mintKeypair.publicKey,
    denominatedInSol: "true", // API expects string "true"
    amount: options?.initialBuyAmount || 0,
    slippage: options?.slippageBps || 10,
    priorityFee: options?.priorityFee || 0.0001,
    pool: "pump",
  };

  const response = await fetch("https://pumpportal.fun/api/trade-local", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Transaction creation failed: ${response.status} - ${errorText}`,
    );
  }

  return response;
}

/**
 * Launch a token on Pump.fun
 * @param publicKey - Public key of the user
 * @param tokenName - Name of the token
 * @param tokenTicker - Ticker of the token
 * @param description - Description of the token
 * @param imageUrl - URL of the token image
 * @param options - Optional token options (twitter, telegram, website, initialBuyAmount, slippageBps, priorityFee)
 * @returns - Signature of the transaction, mint address and metadata URI, if successful, else error
 */
export async function launchPumpFunToken(
  publicKey: string,
  tokenName: string,
  tokenTicker: string,
  description: string,
  imageUrl: string,
  options?: PumpFunTokenOptions,
): Promise<string> {
  try {
    const mintKeypair = Keypair.generate();
    const metadataResponse = await uploadMetadata(
      tokenName,
      tokenTicker,
      description,
      imageUrl,
      options,
    );
    const response = await createTokenTransaction(
      publicKey,
      mintKeypair,
      metadataResponse,
      options,
    );
    const transactionData = await response.arrayBuffer();
    const tx = VersionedTransaction.deserialize(
      new Uint8Array(transactionData),
    );
    tx.sign([mintKeypair]);
    const uint8Array = tx.serialize();
    return btoa(String.fromCharCode(...uint8Array));
  } catch (error) {
    console.error("Error in launchpumpfuntoken:", error);
    if (error instanceof Error && "logs" in error) {
      console.error("Transaction logs:", (error as any).logs);
    }
    throw error;
  }
}
