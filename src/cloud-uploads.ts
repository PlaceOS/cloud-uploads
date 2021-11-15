
export * from './upload';
export * from './api';

/* istanbul ignore file */

export { registerUploadProvider } from './providers.fn';
export { CloudProvider } from './cloud-provider';
export { Amazon } from './providers/amazon';
export { Azure } from './providers/azure';
export { Google } from './providers/google';
export { OpenStack } from './providers/openstack';