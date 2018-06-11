# Evolutionary Serverless Architectures with Safe Deployments

A Sample Implementation of an [evolutionary architecture](https://www.thoughtworks.com/insights/blog/microservices-evolutionary-architecture) for a [serverless](https://aws.amazon.com/serverless/) application using [safe deployments](https://docs.aws.amazon.com/lambda/latest/dg/automating-updates-to-serverless-apps.html), automatically computing the fitness function at deployment time, with the possibility to rollback if fitness is not improving.

The [AWS SAM](https://github.com/awslabs/serverless-application-model) `template.yaml` creates:
* 2 [S3 buckets](https://aws.amazon.com/s3/) (one with [encryption at rest](https://docs.aws.amazon.com/AmazonS3/latest/dev/serv-side-encryption.html) , one not)
* 2 [DynamoDB tables](https://aws.amazon.com/dynamodb/) (one with [encryption at rest](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/EncryptionAtRest.html), one not)
* 2 [Lambda functions](https://aws.amazon.com/lambda/) (`myFirstFunction` and `mySecondFunction`) that implement a basic API (using the [Amazon API Gateway](https://aws.amazon.com/api-gateway/))
* a `preTrafficHook` Lambda function that is used to measure the fitness of the architecture and posts the result as a [CloudWatch metric that you can monitor, alarm or visualize in a dashboard](https://aws.amazon.com/cloudwatch/)

To test the deployment, you can use the following package/deploy commands two times:

* the first time to create the [CloudFormation stack](https://aws.amazon.com/cloudformation/) for the application, as described above
* the second time to update the stack, see how safe deployments work, and how the fitness of the architeture is measured by the PreTraffic function

```
aws cloudformation package -s3-bucket <YOUR_BUCKET> -s3-prefix packages \
    -template-file template.yaml -output-template-file packaged.yaml
```

```
aws cloudformation deploy -template-file packaged.yaml \
    -stack-name EvolutionaryDeployment -capabilities CAPABILITY_IAM
```

For the two Lambda functions providing an API, different deployment strategies are implemented:

* `myFirstFunction` is using a Linear deployment adding 10% of the invocations to the new version every minute (`Linear10PercentEvery1Minute`)
* `mySecondFunction` is using a Canary deployment with 10% of the invocations to the new version for 5 minutes, and then a rollaout to 100% (`Canary10Percent5Minutes`)

To update the Lambda functions in this template with a second deployment, you need to change something in the code in the `src/` folder (or at least save one of the source files again, so that there is a different timestamp).

For more information, please see this article:

