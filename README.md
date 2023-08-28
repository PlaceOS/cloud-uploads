
# Typescript Cloud Uploads Library

To be used in conjuction with [Comdominios](https://github.com/cotag/Condominios).

## Introduction

This project is a library for handling secure direct to cloud uploads that are managed by the [Condominios](https://github.com/cotag/Condominios) project.
At Place we use it to handle all of our file ingestion as it:

* takes the load away from our API servers
* allows us to support hybrid cloud models
* works seamlessly with [AWS Lambda](http://docs.aws.amazon.com/lambda/latest/dg/with-s3.html) and [Google Cloud Functions](https://cloud.google.com/functions/docs)

* Manages an upload queue with pause, resume and progress for each upload
* Supports configuring individual upload parallelism and the number of simultaneous uploads
* All files are hashed in webworkers before upload for data integrity
* Communicates with Condominios to obtain [signed requests](http://docs.aws.amazon.com/AmazonS3/latest/dev/RESTAuthentication.html#UsingTemporarySecurityCredentials) for the uploads

## Usage

Install the node package with `npm install @placeos/cloud-uploads`

Initialise the service in your code before using it.

```typescript
import { initialiseUploadService, Amazon } from '@placeos/cloud-uploads';

function bootstrap() {
    initialiseUploadService({
        auto_start: true,
        token: 'access_token',
        endpoint: '/api/engine/v2/uploads',
        worker_url: 'assets/md5_worker.js',
        providers: [Amazon] as any
    });
}
```

Load file data into browser and call the method to upload the file.

```typescript
import { uploadFiles, Upload } from '@placeos/cloud-uploads';

function uploadFile(file: File) {
    const fileReader = new FileReader();
    fileReader.addEventListener('loadend', (e: any) => {
        const arrayBuffer = e.target.result;
        const blob = blobUtil.arrayBufferToBlob(arrayBuffer, file.type);
        const [upload] = uploadFiles([blob], { file_name: file.name });
        ...
    });
    fileReader.readAsArrayBuffer(file);
}
```

`Upload` type provides an obserable for the status/progress of the upload

```typescript
const [upload] = uploadFiles([blob], { file_name: file.name });
upload.subscribe(
    (state) => state.status === 'error' 
        ? console.log('Status:', state.error) 
        : console.log('Status:', state.status),
)
```



