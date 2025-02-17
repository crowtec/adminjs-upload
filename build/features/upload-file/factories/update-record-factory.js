import { flat } from 'adminjs';
import { DB_PROPERTIES } from '../constants.js';
import { buildRemotePath } from '../utils/build-remote-path.js';
import { getNamespaceFromContext } from './strip-payload-factory.js';
export const updateRecordFactory = (uploadOptionsWithDefault, provider) => {
    const { properties, uploadPath, multiple } = uploadOptionsWithDefault;
    const updateRecord = async (response, request, context) => {
        const { record } = context;
        const { [properties.file]: files, [properties.filesToDelete]: filesToDelete } = getNamespaceFromContext(context);
        const { method } = request;
        if (method !== 'post') {
            return response;
        }
        if (record && record.isValid()) {
            if (multiple && filesToDelete && filesToDelete.length) {
                const filesData = filesToDelete.map((index) => ({
                    key: record.get(properties.key)[index],
                    bucket: record.get(properties.bucket)[index],
                }));
                await Promise.all(filesData.map(async (fileData) => provider.delete(fileData.key, fileData.bucket || provider.bucket, context)));
                const newParams = DB_PROPERTIES.reduce((params, propertyName) => {
                    if (properties[propertyName]) {
                        const filtered = record
                            .get(properties[propertyName])
                            .filter((el, i) => !filesToDelete.includes(i.toString()));
                        return flat.set(params, properties[propertyName], filtered);
                    }
                    return params;
                }, {});
                await record.update(newParams);
            }
            if (multiple && files && files.length) {
                const uploadedFiles = files;
                const keys = await Promise.all(uploadedFiles.map(async (uploadedFile) => {
                    uploadedFile.name = uploadedFile.name || uploadedFile.clientName;
                    uploadedFile.path = uploadedFile.path || uploadedFile.tmpPath;
                    const key = buildRemotePath(record, uploadedFile, uploadPath);
                    await provider.upload(uploadedFile, key, context);
                    return key;
                }));
                let params = flat.set({}, properties.key, [...(record.get(properties.key) || []), ...keys]);
                if (properties.bucket) {
                    params = flat.set(params, properties.bucket, [
                        ...(record.get(properties.bucket) || []),
                        ...uploadedFiles.map(() => provider.bucket),
                    ]);
                }
                if (properties.size) {
                    params = flat.set(params, properties.size, [
                        ...(record.get(properties.size) || []),
                        ...uploadedFiles.map((file) => file.size),
                    ]);
                }
                if (properties.mimeType) {
                    params = flat.set(params, properties.mimeType, [
                        ...(record.get(properties.mimeType) || []),
                        ...uploadedFiles.map((file) => file.type),
                    ]);
                }
                if (properties.filename) {
                    params = flat.set(params, properties.filename, [
                        ...(record.get(properties.filename) || []),
                        ...uploadedFiles.map((file) => file.name),
                    ]);
                }
                await record.update(params);
                return {
                    ...response,
                    record: record.toJSON(context.currentAdmin),
                };
            }
            if (!multiple && files && files.length) {
                let uploadedFile = files[0];
                uploadedFile.name = uploadedFile.name || uploadedFile.clientName;
                uploadedFile.path = uploadedFile.path || uploadedFile.tmpPath;
                const oldRecordParams = { ...record.params };
                const key = buildRemotePath(record, uploadedFile, uploadPath);
                await provider.upload(uploadedFile, key, context);
                const params = {
                    [properties.key]: key,
                    ...(properties.bucket && { [properties.bucket]: provider.bucket }),
                    ...(properties.size && { [properties.size]: uploadedFile.size?.toString() }),
                    ...(properties.mimeType && { [properties.mimeType]: uploadedFile.type }),
                    ...(properties.filename && { [properties.filename]: uploadedFile.name }),
                };
                await record.update(params);
                const oldKey = oldRecordParams[properties.key] && oldRecordParams[properties.key];
                const oldBucket = (properties.bucket && oldRecordParams[properties.bucket]) || provider.bucket;
                if (oldKey && oldBucket && (oldKey !== key || oldBucket !== provider.bucket)) {
                    await provider.delete(oldKey, oldBucket, context);
                }
                return {
                    ...response,
                    record: record.toJSON(context.currentAdmin),
                };
            }
            // someone wants to remove one file
            if (!multiple && files === null) {
                const bucket = (properties.bucket && record.get(properties.bucket)) || provider.bucket;
                const key = record.get(properties.key);
                // and file exists
                if (key && bucket) {
                    const params = {
                        [properties.key]: null,
                        ...(properties.bucket && { [properties.bucket]: null }),
                        ...(properties.size && { [properties.size]: null }),
                        ...(properties.mimeType && { [properties.mimeType]: null }),
                        ...(properties.filename && { [properties.filename]: null }),
                    };
                    await record.update(params);
                    await provider.delete(key, bucket, context);
                    return {
                        ...response,
                        record: record.toJSON(context.currentAdmin),
                    };
                }
            }
        }
        return response;
    };
    return updateRecord;
};
