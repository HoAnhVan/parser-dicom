import React, { useState } from 'react';
import { Button, Layout, Menu, Form, Input, message, Spin, Radio } from 'antd';
import {
  CloudOutlined,
  DesktopOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import AWS from 'aws-sdk';
import dcmjs from 'dcmjs';
import './App.css';

const { Header, Sider, Content } = Layout;

let presetsData = [];

function App() {
  const [activeMenu, setActiveMenu] = useState('s3');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [bucketName, setBucketName] = useState('');
  const [dataPath, setDataPath] = useState('');
  const [processing, setProcessing] = useState(false);
  const [type, setType] = useState(1);

  const handleDownloadPreset = (jsonData = []) => {
    try {
      const today = new Date();
      const yyyy = today.getFullYear();
      let mm = today.getMonth() + 1; // Months start at 0!
      let dd = today.getDate();

      if (dd < 10) dd = '0' + dd;
      if (mm < 10) mm = '0' + mm;

      const dataStr =
        'data:text/json;charset=utf-8,' +
        encodeURIComponent(JSON.stringify(jsonData));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute('href', dataStr);
      downloadAnchorNode.setAttribute(
        'download',
        `preset_${yyyy}${mm}${dd}_${today.getHours()}${today.getMinutes()}${today.getSeconds()}.json`
      );
      document.body.appendChild(downloadAnchorNode); // required for firefox
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    } catch (error) {
      console.log(error);
    }
  };

  const handleGetPreset = async () => {
    if (processing) return;
    if (activeMenu === 'local') {
      if (!presetsData.length) {
        return;
      }
      setProcessing(true);
      handleDownloadPreset(presetsData);
      setProcessing(false);
    } else {
      if (!accessKeyId || !secretAccessKey || !bucketName) {
        return;
      }

      try {
        setProcessing(true);
        AWS.config.update({
          accessKeyId: accessKeyId,
          secretAccessKey: secretAccessKey,
        });
        const s3 = new AWS.S3();
        const paramsList = {
          Bucket: bucketName,
          Prefix: dataPath,
        };

        s3.listObjects(paramsList, (err, data) => {
          if (err) {
            message.error(`${err.name}: ${err.message}`);
            setProcessing(false);
          } else {
            const contents = data.Contents || [];
            let promises = [];
            contents.forEach((item) => {
              if (item.Size > 0) {
                promises.push(
                  s3.getObject({ Bucket: bucketName, Key: item.Key }).promise()
                );
              }
            });

            Promise.all(promises).then(async (results) => {
              let files = [];
              results.forEach((file) => {
                const { Key = '' } = file.$response?.request?.params || {};
                if (Key) {
                  const splitKey = Key.split('/');
                  const fileName = splitKey[splitKey.length - 1];
                  let fileBlob = new Blob([file.Body.buffer], {
                    type: file.ContentType,
                  });
                  const filedata = new File([fileBlob], fileName);
                  files.push(filedata);
                }
              });
              await createPresetData(files);
              if (!presetsData.length) {
                return;
              }
              handleDownloadPreset(presetsData);
              setProcessing(false);
            });
          }
        });
      } catch (error) {
        setProcessing(false);
      }
    }
  };

  const groupSeries = (studies) => {
    const groupBy = (list, groupByKey, listKey) => {
      let nonKeyCounter = 1;

      return list.reduce((acc, obj) => {
        let key = obj[groupByKey];
        const list = obj[listKey];

        // in case key not found, group it using counter
        key = !!key ? key : '' + nonKeyCounter++;

        if (!acc[key]) {
          acc[key] = { ...obj };
          acc[key][listKey] = [];
        }

        acc[key][listKey].push(...list);

        return acc;
      }, {});
    };

    const studiesGrouped = Object.values(
      groupBy(studies, 'StudyInstanceUID', 'series')
    );

    const result = studiesGrouped.map((studyGroup) => {
      const seriesGrouped = groupBy(
        studyGroup.series,
        'SeriesInstanceUID',
        'instances'
      );
      studyGroup.series = Object.values(seriesGrouped);

      return studyGroup;
    });

    return result;
  };

  const getStudyFromDataset = (dataset = {}) => {
    const {
      StudyInstanceUID,
      SeriesInstanceUID,
      SOPInstanceUID,
      SeriesNumber = 0,
      InstanceNumber = 0,
      fileName,
    } = dataset;

    const instance = {
      SOPInstanceUID,
      InstanceNumber,
      metadata: dataset,
      fileName,
    };

    const series = {
      SeriesInstanceUID: SeriesInstanceUID,
      SeriesNumber: SeriesNumber,
      instances: [instance],
    };

    const study = {
      StudyInstanceUID,
      series: [series],
    };

    return study;
  };

  const processFile = async (file) => {
    try {
      const bufferData = await loadFileRequest(file);
      const dataset = await getDataset(bufferData, file.name);
      const study = await getStudyFromDataset(dataset);

      return study;
    } catch (error) {
      console.log(
        error.name,
        ':Error when trying to load and process local files:',
        error.message
      );
    }
  };

  const onChangeFile = (files = []) => {
    setProcessing(true);
    createPresetData(files);
    setProcessing(false);
  };

  const createPresetData = async (files = []) => {
    if (!files.length) return;
    presetsData = [];
    const processFilesPromises = Array.from(files).map(processFile);
    const studies = await Promise.all(processFilesPromises);
    const groupData = groupSeries(studies);
    groupData.forEach((it) => {
      if (it.series?.length > 1) {
        it.series.sort((a, b) => a.SeriesNumber - b.SeriesNumber);
      }

      const tranformData = {
        study: {
          study_instance_uid: it.StudyInstanceUID,
          name: it.StudyInstanceUID,
        },
        series: it.series.map((ser) => {
          if (ser.instances?.length > 1) {
            ser.instances.sort((a, b) => a.InstanceNumber - b.InstanceNumber);
          }

          const serData = {
            series_instance_uid: ser.SeriesInstanceUID,
            items: ser.instances.map((inst) => {
              if (type === 1) {
                const instData = {
                  sop_instance_uid: inst.SOPInstanceUID,
                  file_name: `${dataPath}/${inst.fileName}`,
                };
                return instData;
              } else {
                return `${dataPath}/${inst.fileName}`;
              }
            }),
          };
          return serData;
        }),
      };
      presetsData.push(tranformData);
    });
  };

  return (
    <Layout className="App">
      <Sider collapsible>
        <div className="logo">DICOM PARSER</div>
        <Menu
          theme="dark"
          mode="inline"
          defaultSelectedKeys={[activeMenu]}
          onSelect={({ key }) => {
            if (!processing) {
              presetsData = [];
              setActiveMenu(key);
            }
          }}
          items={[
            {
              key: 's3',
              icon: <CloudOutlined />,
              label: 'Clould (AWS s3)',
            },
            {
              key: 'local',
              icon: <DesktopOutlined />,
              label: 'Local',
            },
          ]}
        />
      </Sider>
      <Layout className="site-layout">
        <Header
          style={{
            padding: 0,
          }}
        ></Header>
        <Content
          style={{
            padding: 24,
            minHeight: 280,
          }}
        >
          <Spin spinning={processing}>
            <Form labelCol={{ span: 8 }} wrapperCol={{ span: 16 }}>
              {activeMenu === 'local' && (
                <>
                  <Form.Item label="Select files">
                    <input
                      className="input-file"
                      type="file"
                      multiple
                      onChange={(evt) => onChangeFile(evt?.target?.files)}
                      accept={'.dcm, .dicom'}
                      onClick={(event) => (event.target.value = null)}
                    />
                  </Form.Item>
                </>
              )}

              {activeMenu === 's3' && (
                <>
                  <Form.Item label="Access Key">
                    <Input
                      defaultValue={accessKeyId}
                      onChange={(e) => setAccessKeyId(e.target.value)}
                    />
                  </Form.Item>
                  <Form.Item label="Secret Key">
                    <Input
                      defaultValue={secretAccessKey}
                      onChange={(e) => setSecretAccessKey(e.target.value)}
                    />
                  </Form.Item>
                  <Form.Item label="Bucket">
                    <Input
                      defaultValue={bucketName}
                      onChange={(e) => setBucketName(e.target.value)}
                    />
                  </Form.Item>
                </>
              )}
              <Form.Item label="Data path">
                <Input
                  defaultValue={dataPath}
                  onChange={(e) => setDataPath(e.target.value)}
                />
              </Form.Item>
              <Form.Item label="Type">
                <Radio.Group
                  onChange={(e) => setType(e.target.value)}
                  value={type}
                >
                  <Radio value={1}>v3.1</Radio>
                  <Radio value={2}>v3.2</Radio>
                </Radio.Group>
              </Form.Item>
              <Form.Item wrapperCol={{ offset: 8, span: 16 }}>
                <Button
                  type="primary"
                  onClick={handleGetPreset}
                  icon={<DownloadOutlined />}
                >
                  Download
                </Button>
              </Form.Item>
            </Form>
          </Spin>
        </Content>
      </Layout>
    </Layout>
  );
}

export default App;

function loadFileRequest(file) {
  return new Promise((resolve, reject) => {
    const fileReader = new FileReader();

    fileReader.onload = (e) => {
      const dicomPart10AsArrayBuffer = e.target.result;

      resolve(dicomPart10AsArrayBuffer);
    };

    fileReader.onerror = reject;

    fileReader.readAsArrayBuffer(file);
  });
}

function getDataset(bufferData, fileName = '') {
  let dataset = {};
  try {
    const dicomData = dcmjs.data.DicomMessage.readFile(bufferData);
    dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomData.dict);
    dataset._meta = dcmjs.data.DicomMetaDictionary.namifyDataset(
      dicomData.meta
    );
    dataset.fileName = fileName;
  } catch (e) {
    console.error('Error reading dicom file', e);
  }

  return dataset;
}
