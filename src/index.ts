export {
    addProviders,
    initialiseUploadService,
    listUploads,
    pauseAllUploads,
    removeAllUploads,
    removeCompletedUploads,
    removeUpload,
    resumeAllUploads,
    resumeUpload,
    updateUploadMetadata,
    uploadFiles,
    type UploadServiceOptions,
} from './api';
export { hexToBinary, humanReadableByteCount, toQueryString } from './helpers';
export { SignedRequest } from './signed-request';
export { Upload, type UploadState, type UploadStatus } from './upload';

export { initUploads, uploadFile, type UploadConfig } from './new';

/* istanbul ignore file */

export { CloudProvider } from './cloud-provider';
export { registerUploadProvider } from './providers.fn';
export { Amazon } from './providers/amazon';
export { Azure } from './providers/azure';
export { Google } from './providers/google';
export { OpenStack } from './providers/openstack';
