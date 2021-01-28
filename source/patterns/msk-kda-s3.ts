/*********************************************************************************************************************
 *  Copyright 2020-2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.                                      *
 *                                                                                                                    *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance    *
 *  with the License. A copy of the License is located at                                                             *
 *                                                                                                                    *
 *      http://www.apache.org/licenses/LICENSE-2.0                                                                    *
 *                                                                                                                    *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES *
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions    *
 *  and limitations under the License.                                                                                *
 *********************************************************************************************************************/

import * as cdk from '@aws-cdk/core';
import * as cwlogs from '@aws-cdk/aws-logs';

import { FlinkApplication } from '../lib/kda-flink-application';
import { EncryptedBucket } from '../lib/s3-bucket';
import { KafkaMetadata } from '../lib/msk-custom-resource';
import { SolutionHelper } from '../lib/solution-helper';
import { SolutionStackProps } from './solution-props';
import { ApplicationMonitoring } from '../lib/kda-monitoring';

export class MskKdaS3 extends cdk.Stack {
    private readonly BinaryOptions = ['true', 'false'];

    constructor(scope: cdk.Construct, id: string, props: SolutionStackProps) {
        super(scope, id, props);

        //---------------------------------------------------------------------
        // Amazon MSK configuration

        const clusterArn = new cdk.CfnParameter(this, 'ClusterArn', {
            type: 'String',
            allowedPattern: 'arn:(aws[a-zA-Z0-9-]*):([a-zA-Z0-9\\-])+:([a-z]{2}(-gov)?-[a-z]+-\\d{1})?:(\\d{12})?:(.*)',
            constraintDescription: 'Cluster ARN must be in the following format: arn:${Partition}:kafka:${Region}:${Account}:cluster/${ClusterName}/${UUID}'
        });

        const topicName = new cdk.CfnParameter(this, 'TopicName', {
            type: 'String',
            allowedPattern: '.+',
            constraintDescription: 'Topic name must not be empty'
        });

        const kafkaHelper = new KafkaMetadata(this, 'Msk', {
            clusterArn: clusterArn.valueAsString
        });

        //---------------------------------------------------------------------
        // Kinesis Data Analytics configuration

        const outputBucket = new EncryptedBucket(this, 'Output', {
            enableIntelligentTiering: true
        });

        const logLevel = new cdk.CfnParameter(this, 'LogLevel', {
            type: 'String',
            default: 'INFO',
            allowedValues: FlinkApplication.AllowedLogLevels
        });

        const metricsLevel = new cdk.CfnParameter(this, 'MetricsLevel', {
            type: 'String',
            default: 'TASK',
            allowedValues: FlinkApplication.AllowedMetricLevels
        });

        const snapshots = new cdk.CfnParameter(this, 'EnableSnapshots', {
            type: 'String',
            default: 'true',
            allowedValues: this.BinaryOptions
        });

        const autoScaling = new cdk.CfnParameter(this, 'EnableAutoScaling', {
            type: 'String',
            default: 'true',
            allowedValues: this.BinaryOptions
        });

        const kda = new FlinkApplication(this, 'Kda', {
            environmentProperties: {
                propertyGroupId: 'FlinkApplicationProperties',
                propertyMap: {
                    'TopicName': topicName.valueAsString,
                    'BootstrapServers': kafkaHelper.BootstrapServers,
                    'OutputBucketName': outputBucket.Bucket.bucketName,
                }
            },

            logsRetentionDays: cwlogs.RetentionDays.ONE_YEAR,
            logLevel: logLevel.valueAsString,
            metricsLevel: metricsLevel.valueAsString,

            enableSnapshots: snapshots.valueAsString,
            enableAutoScaling: autoScaling.valueAsString,

            codeBucketArn: `arn:${cdk.Aws.PARTITION}:s3:::%%BUCKET_NAME%%-${cdk.Aws.REGION}`,
            codeFileKey: cdk.Fn.join('/', ['%%SOLUTION_NAME%%/%%VERSION%%', 'kda-flink-kafka.zip']),

            subnetIds: cdk.Token.asList(kafkaHelper.Subnets),
            securityGroupIds: cdk.Token.asList(kafkaHelper.SecurityGroups)
        });

        outputBucket.Bucket.grantReadWrite(kda.ApplicationRole);

        //---------------------------------------------------------------------
        // Solution metrics

        new SolutionHelper(this, 'SolutionHelper', {
            solutionId: props.solutionId,
            pattern: MskKdaS3.name
        });

        //---------------------------------------------------------------------
        // Monitoring (dashboard and alarms) configuration

        new ApplicationMonitoring(this, 'Monitoring', {
            applicationName: kda.ApplicationName,
            logGroupName: kda.LogGroupName,
            kafkaTopicName: topicName.valueAsString
        });

        //---------------------------------------------------------------------
        // Template metadata

        this.templateOptions.metadata = {
            'AWS::CloudFormation::Interface': {
                ParameterGroups: [
                    {
                        Label: { default: 'Amazon MSK configuration' },
                        Parameters: [clusterArn.logicalId, topicName.logicalId]
                    },
                    {
                        Label: { default: 'Amazon Kinesis Data Analytics configuration' },
                        Parameters: [
                            logLevel.logicalId,
                            metricsLevel.logicalId,
                            snapshots.logicalId,
                            autoScaling.logicalId,
                        ]
                    }
                ],
                ParameterLabels: {
                    [clusterArn.logicalId]: {
                        default: 'ARN of the MSK cluster'
                    },
                    [topicName.logicalId]: {
                        default: 'Name of a Kafka topic to consume (topic must already exist before the stack is launched)'
                    },

                    [logLevel.logicalId]: {
                        default: 'Monitoring log level'
                    },
                    [metricsLevel.logicalId]: {
                        default: 'Monitoring metrics level'
                    },
                    [snapshots.logicalId]: {
                        default: 'Enable service-triggered snapshots'
                    },
                    [autoScaling.logicalId]: {
                        default: 'Enable automatic scaling'
                    }
                }
            }
        };

        //---------------------------------------------------------------------
        // Stack outputs

        new cdk.CfnOutput(this, 'ApplicationName', {
            description: 'Name of the Amazon Kinesis Data Analytics application',
            value: kda.ApplicationName
        });

        new cdk.CfnOutput(this, 'OutputBucketName', {
            description: 'Name of the Amazon S3 destination bucket',
            value: outputBucket.Bucket.bucketName
        });
    }
}
