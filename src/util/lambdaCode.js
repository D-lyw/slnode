/**
 * 上传代码至 AWS的 s3 服务
 */

const path = require('path')
const fs = require('fs')
const fsPromise = require('fs').promises

const readFromDisk = function (packageArchive) {
    return fsPromise.readFile(packageArchive)
        .then(fileContent => ({ZipFile: fileContent}))
}

const uploadToS3 = function (s3, filePath, bucket, serverSideEncryption, s3Key) {
    const fileKey = s3Key ? s3Key : path.basename(filePath)
    const params = {
        Bucket: bucket,
        Key: fileKey,
        Body: fs.createReadStream(filePath),
        ACL: 'private'
    }
    if (serverSideEncryption) {
        params.ServerSideEncryption = serverSideEncryption
    }
    return s3.upload(params).promise()
        .then(() => ({
            S3Bucket: bucket,
            S3Key: fileKey
        }))
}

module.exports = function lambdaCode(s3, zipArchive, s3Bucket, s3ServerSideEncryption, s3Key) {
    if (!s3Bucket) {
        return readFromDisk(zipArchive)
    } else {
        return uploadToS3(s3, zipArchive, s3Bucket, s3ServerSideEncryption, s3Key)
    }
}