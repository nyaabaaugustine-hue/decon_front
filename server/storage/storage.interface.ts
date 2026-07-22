export interface PresignedUpload {
  uploadUrl: string;
  objectKey: string;
  bucket: string;
  expiresIn: number;
}

export interface StorageProvider {
  presignUpload(bucket: string, objectKey: string, contentType: string, expiresInSeconds?: number): Promise<PresignedUpload>;
  presignDownload(bucket: string, objectKey: string, expiresInSeconds?: number): Promise<string>;
  publicUrl(bucket: string, objectKey: string): string;
  deleteObject(bucket: string, objectKey: string): Promise<void>;
  objectExists(bucket: string, objectKey: string): Promise<boolean>;
}
