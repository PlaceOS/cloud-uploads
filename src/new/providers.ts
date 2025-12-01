import { UploadPart } from './types';
import { Upload } from './upload';

const MiB = 1024 * 1024;

export interface Provider {
    readonly name: string;
    readonly part_size: number;
    readonly resume_id: (txt: string) => string;
    readonly finalise_body: (u: Upload, partData: UploadPart[]) => string;
}

/** Pad a number to 6 digits */
function padPartNumber(num: number): string {
    return num.toString().padStart(6, '0');
}

export const EMPTY_PROVIDER: Provider = {
    name: 'EMPTY',
    part_size: 5 * MiB,
    resume_id: () => '',
    finalise_body: () => '',
};

export const Amazon: Provider = {
    name: 'AmazonS3',
    part_size: 5 * MiB,
    resume_id: (text: string) => {
        const parser = new DOMParser();
        const xml_doc = parser.parseFromString(text, 'application/xml');
        return xml_doc.getElementsByTagName('UploadId')[0].textContent || '';
    },
    finalise_body: (_upload: Upload, partData: UploadPart[]) => {
        // Generate XML manifest for S3 CompleteMultipartUpload
        // S3 requires hex MD5 values for ETags
        let xml = '<CompleteMultipartUpload>';
        for (const part of partData) {
            xml += `<Part><PartNumber>${part.part}</PartNumber><ETag>"${part.md5_hex}"</ETag></Part>`;
        }
        xml += '</CompleteMultipartUpload>';
        return xml;
    },
};

export const Google: Provider = {
    name: 'GoogleCloudStorage',
    part_size: 5 * MiB,
    // Google's resumable upload ID comes from the Location header, not response body
    // The server extracts it from the header and provides it in the response
    resume_id: (text: string) => {
        // If the server provides a JSON response with the upload_id
        try {
            const data = JSON.parse(text);
            return data.upload_id || data.resumable_id || '';
        } catch {
            // Not JSON, return empty - server will handle via headers
            return '';
        }
    },
    // Google uses resumable uploads - no manifest needed
    finalise_body: () => '',
};

export const Azure: Provider = {
    name: 'AzureStorage',
    part_size: 2 * MiB,
    // Azure uses block IDs, not a resumable upload ID
    // Use a placeholder that identifies this upload session
    resume_id: (_text: string) => {
        return window.btoa(padPartNumber(1));
    },
    finalise_body: (upload: Upload, _partData: UploadPart[]) => {
        // Generate XML BlockList for Azure
        const totalParts = Math.ceil(upload.file.size / Azure.part_size);
        let xml = '<?xml version="1.0" encoding="utf-8"?><BlockList>';
        for (let i = 1; i <= totalParts; i++) {
            xml += `<Latest>${window.btoa(padPartNumber(i))}</Latest>`;
        }
        xml += '</BlockList>';
        return xml;
    },
};

export const OpenStack: Provider = {
    name: 'OpenStackSwift',
    part_size: 2 * MiB,
    // OpenStack Swift doesn't use resumable IDs for static large objects
    resume_id: () => 'n/a',
    // OpenStack manifest is typically generated server-side
    // If needed client-side, it requires path info from server responses
    finalise_body: () => '',
};

export function providerByName(name: string): Provider {
    if (name === Amazon.name) return Amazon;
    if (name === Google.name) return Google;
    if (name === Azure.name) return Azure;
    if (name === OpenStack.name) return OpenStack;
    console.warn(`[UPLOADS] Unknown provider: "${name}", using EMPTY_PROVIDER`);
    return EMPTY_PROVIDER;
}
