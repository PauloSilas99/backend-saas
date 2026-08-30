import { randomUUID } from 'crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { v2 as cloudinary } from 'cloudinary';

export type EvidenceUpload = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  tenantId: string;
  planId: string;
};

export type EvidenceDownload =
  | { redirectTo: string }
  | { body: Buffer; mimeType: string };

export type EvidenceResourceType = 'image' | 'video' | 'raw';

export function evidenceResourceTypeFor(mimeType: string | undefined): EvidenceResourceType {
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'video';
  return 'raw';
}

const RESOURCE_TYPES: readonly EvidenceResourceType[] = ['image', 'video', 'raw'];

export function storedResourceType(evidence: {
  resourceType?: string | null;
  mimeType?: string | null;
}): EvidenceResourceType {
  const stored = evidence.resourceType as EvidenceResourceType | null | undefined;
  if (stored && RESOURCE_TYPES.includes(stored)) return stored;
  return evidenceResourceTypeFor(evidence.mimeType ?? undefined);
}

export interface EvidenceStorage {
  readonly name: 'cloudinary' | 'local';
  upload(input: EvidenceUpload): Promise<{ publicId: string; resourceType: EvidenceResourceType }>;
  download(publicId: string, resourceType: EvidenceResourceType): Promise<EvidenceDownload>;
  destroy(publicId: string, resourceType: EvidenceResourceType): Promise<void>;
}

const SIGNED_URL_TTL_SECONDS = 300;

export class LocalEvidenceStorage implements EvidenceStorage {
  readonly name = 'local' as const;

  constructor(private readonly root: string) {}

  private resolveInsideRoot(publicId: string): string {
    const resolved = path.resolve(this.root, publicId);
    const boundary = path.resolve(this.root) + path.sep;
    if (!resolved.startsWith(boundary)) {
      throw new Error('Caminho de evidência fora do diretório permitido');
    }
    return resolved;
  }

  async upload(
    input: EvidenceUpload,
  ): Promise<{ publicId: string; resourceType: EvidenceResourceType }> {
    const extension = path.extname(input.fileName).slice(0, 10);
    const publicId = `${input.tenantId}/${input.planId}/${randomUUID()}${extension}`;
    const target = this.resolveInsideRoot(publicId);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, input.buffer);
    writeFileSync(`${target}.type`, input.mimeType);
    return { publicId, resourceType: evidenceResourceTypeFor(input.mimeType) };
  }

  async download(publicId: string, _resourceType?: EvidenceResourceType): Promise<EvidenceDownload> {
    const target = this.resolveInsideRoot(publicId);
    return {
      body: readFileSync(target),
      mimeType: readFileSync(`${target}.type`, 'utf8'),
    };
  }

  async destroy(publicId: string, _resourceType?: EvidenceResourceType): Promise<void> {
    const target = this.resolveInsideRoot(publicId);
    rmSync(target, { force: true });
    rmSync(`${target}.type`, { force: true });
  }
}

export class CloudinaryEvidenceStorage implements EvidenceStorage {
  readonly name = 'cloudinary' as const;

  constructor(credentials: { cloudName: string; apiKey: string; apiSecret: string }) {
    cloudinary.config({
      cloud_name: credentials.cloudName,
      api_key: credentials.apiKey,
      api_secret: credentials.apiSecret,
      secure: true,
    });
  }

  async upload(
    input: EvidenceUpload,
  ): Promise<{ publicId: string; resourceType: EvidenceResourceType }> {
    const result = await new Promise<{ public_id: string; resource_type?: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `saas-pgr/${input.tenantId}/${input.planId}`,
          resource_type: 'auto',
          type: 'authenticated',
          filename_override: input.fileName,
          use_filename: false,
        },
        (error, uploaded) => {
          if (error || !uploaded) reject(error ?? new Error('Falha ao enviar evidência'));
          else resolve(uploaded as { public_id: string; resource_type?: string });
        },
      );
      stream.end(input.buffer);
    });
    const declared = result.resource_type as EvidenceResourceType | undefined;
    return {
      publicId: result.public_id,
      resourceType: declared ?? evidenceResourceTypeFor(input.mimeType),
    };
  }

  async download(
    publicId: string,
    resourceType: EvidenceResourceType,
  ): Promise<EvidenceDownload> {
    return {
      redirectTo: cloudinary.url(publicId, {
        resource_type: resourceType,
        type: 'authenticated',
        sign_url: true,
        secure: true,
        expires_at: Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS,
      }),
    };
  }

  async destroy(publicId: string, resourceType: EvidenceResourceType): Promise<void> {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
      type: 'authenticated',
      invalidate: true,
    });
  }
}

export function selectEvidenceStorage(env: {
  CLOUDINARY_CLOUD_NAME?: string;
  CLOUDINARY_API_KEY?: string;
  CLOUDINARY_API_SECRET?: string;
  UPLOAD_DIR: string;
}): EvidenceStorage {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = env;
  if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
    return new CloudinaryEvidenceStorage({
      cloudName: CLOUDINARY_CLOUD_NAME,
      apiKey: CLOUDINARY_API_KEY,
      apiSecret: CLOUDINARY_API_SECRET,
    });
  }
  return new LocalEvidenceStorage(path.resolve(process.cwd(), env.UPLOAD_DIR, 'evidences'));
}
