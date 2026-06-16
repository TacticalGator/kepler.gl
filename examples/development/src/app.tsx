// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

import React, {useCallback, useEffect, useRef, useState} from 'react';
import AutoSizer from 'react-virtualized/dist/commonjs/AutoSizer';
import styled, {ThemeProvider, StyleSheetManager} from 'styled-components';
import Window from 'global/window';
import {connect, useDispatch} from 'react-redux';
import cloneDeep from 'lodash/cloneDeep';
import isEqual from 'lodash/isEqual';
import {useSelector} from 'react-redux';
import isPropValid from '@emotion/is-prop-valid';
import {WebMercatorViewport} from '@deck.gl/core';
import {ScreenshotWrapper} from '@openassistant/ui';
import {
  setStartScreenCapture,
  setScreenCaptured,
  AiAssistantPanel,
  setMapBoundary
} from '@kepler.gl/ai-assistant';
import {panelBorderColor, theme} from '@kepler.gl/styles';
import {ParsedConfig} from '@kepler.gl/types';
import {getApplicationConfig} from '@kepler.gl/utils';
import {SqlPanel} from '@kepler.gl/duckdb';
import Banner from './components/banner';
import Announcement, {FormLink} from './components/announcement';
import {replaceLoadDataModal} from './factories/load-data-modal';
import {replaceMapControl} from './factories/map-control';
import {replacePanelHeader} from './factories/panel-header';
import {CLOUD_PROVIDERS_CONFIGURATION, DEFAULT_FEATURE_FLAGS} from './constants/default-settings';
import {messages} from './constants/localization';

import {
  loadRemoteMap,
} from './actions';

import {
  addDataToMap,
  replaceDataInMap,
  toggleMapControl,
  toggleModal,
  updateVisData,
  receiveMapConfig
} from '@kepler.gl/actions';
import {
  getMetaUrl,
  parseVectorMetadata,
  getFieldsFromTile,
  getWMSCapabilities,
  wmsCapabilitiesToDatasetMetadata
} from '@kepler.gl/table';
import KeplerGlSchema from '@kepler.gl/schemas';
import {isPMTilesUrl} from '@kepler.gl/common-utils';
import {DatasetType, REMOTE_TILE, RemoteTileFormat} from '@kepler.gl/constants';
import {Panel, PanelGroup, PanelResizeHandle} from 'react-resizable-panels';

const KeplerGl = require('@kepler.gl/components').injectComponents([
  replaceLoadDataModal(),
  replaceMapControl(),
  replacePanelHeader()
]);

/* eslint-disable no-unused-vars */
import {processGeojson, processCsvData} from '@kepler.gl/processors';

/* eslint-enable no-unused-vars */

// Switch to false to hide console logs
const DEBUG = true;
const log = (...args) => {
  if (DEBUG) {
    console.log(...args);
  }
};

// This implements the default behavior from styled-components v5
function shouldForwardProp(propName, target) {
  if (typeof target === 'string') {
    // For HTML elements, forward the prop if it is a valid HTML attribute
    return isPropValid(propName);
  }
  // For other elements, forward all props
  return true;
}

const BannerHeight = 48;
const BannerKey = `banner-${FormLink}`;
const keplerGlGetState = state => state.demo.keplerGl;

const GlobalStyle = styled.div`
  font-family: ff-clan-web-pro, 'Helvetica Neue', Helvetica, sans-serif;
  font-weight: 400;
  font-size: 0.875em;
  line-height: 1.71429;

  *,
  *:before,
  *:after {
    -webkit-box-sizing: border-box;
    -moz-box-sizing: border-box;
    box-sizing: border-box;
  }

  ul {
    margin: 0;
    padding: 0;
  }

  li {
    margin: 0;
  }

  a {
    text-decoration: none;
    color: ${props => props.theme.labelColor};
  }
`;

const CONTAINER_STYLE = {
  transition: 'margin 1s, height 1s',
  position: 'absolute',
  width: '100%',
  height: '100%',
  left: 0,
  top: 0,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: '#333'
};

const StyledResizeHandle = styled(PanelResizeHandle)`
  background-color: ${panelBorderColor};
  &:hover {
    background-color: #555;
  }
  width: 100%;
  height: 5px;
  cursor: row-resize;
`;

const StyledVerticalResizeHandle = styled(PanelResizeHandle)`
  background-color: ${panelBorderColor};
  width: 4px;
  height: 100%;
  cursor: row-resize;

  &:hover {
    background-color: #555;
  }
`;

function exportToJson(data, filename) {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const App = props => {
  const [showBanner, toggleShowBanner] = useState(false);
  const {params: {id, provider} = {}, location: {query = {}} = {}} = props;
  const dispatch = useDispatch();

  const keplerGlState = useSelector(state => state.demo.keplerGl.map);

  const _saveConfig = useCallback(() => {
    const config = KeplerGlSchema.getConfigToSave(keplerGlState);
    exportToJson(config, 'keplergl_config.json');
  }, [keplerGlState]);

  useEffect(() => {
    window.saveKeplerConfig = _saveConfig;
  }, [_saveConfig]);

  // TODO find another way to check for existence of duckDb plugin
  const duckDbPluginEnabled = (getApplicationConfig().plugins || []).some(p => p.name === 'duckdb');

  const isSqlPanelOpen = useSelector(
    state => duckDbPluginEnabled && state?.demo?.keplerGl?.map?.uiState.mapControls.sqlPanel?.active
  );

  const isAiAssistantPanelOpen = useSelector(
    state => state?.demo?.keplerGl?.map?.uiState.mapControls.aiAssistant?.active
  );

  const prevQueryRef = useRef<number>(null);

  const [configLoaded, setConfigLoaded] = useState(false);

  const _loadWmsData = useCallback(() => {
    const loadWmsDataset = async (wmsUrl, datasetName) => {
      log(`[${datasetName}] Starting to load WMS dataset...`);
      try {
        // 1. Fetch and parse WMS capabilities
        log(`[${datasetName}] Fetching WMS capabilities from: ${wmsUrl}`);
        const capabilities = await getWMSCapabilities(wmsUrl);
        const datasetMetadata = wmsCapabilitiesToDatasetMetadata(capabilities);
        log(`[${datasetName}] WMS capabilities received and parsed:`, capabilities);

        // 2. Prepare dataset for updateVisData
        const dataset = {
          info: {
            id: datasetName,
            label: datasetName,
            type: DatasetType.WMS_TILE
          },
          data: {
            fields: [],
            rows: []
          },
          metadata: {
            type: REMOTE_TILE,
            remoteTileFormat: RemoteTileFormat.WMS,
            tilesetDataUrl: wmsUrl,
            tilesetMetadataUrl: `${wmsUrl}?service=WMS&request=GetCapabilities`,
            layers: datasetMetadata.layers || [],
            wmsVersion: datasetMetadata.version || '1.3.0'
          }
        };

        // 3. Dispatch action to add dataset to map
        log(`[${datasetName}] Adding dataset to map...`);
        dispatch(updateVisData(
          dataset,
          {
            autoCreateLayers: true,
            centerMap: true
          }
        ));

      } catch (error) {
        console.error(`[${datasetName}] Failed to load WMS dataset:`, error);
      }
    }

//  Add WMS datasets below
//    loadWmsDataset('', '');

//  Sentinel Series
//  All-weather radar (Sentinel-1)
//  High-resolution optical (Sentinel-2)
//  Ocean, land, and atmospheric biophysical data (Sentinel-3)
//  Air quality and trace gases (Sentinel-5P)
    loadWmsDataset('https://sh.dataspace.copernicus.eu/ogc/wms/51d1f5b6-f1d7-4c49-acfc-70dfb8fa84e0', 'Copernicus DEM');
    loadWmsDataset('https://sh.dataspace.copernicus.eu/ogc/wms/1ffd71ef-3953-4da4-a4d8-f87453144f59', 'Sentinel-1 GRD');
    loadWmsDataset('https://sh.dataspace.copernicus.eu/ogc/wms/955e9f7f-262d-427c-8776-8ff20a7ca0da', 'Sentinel-2 L1C');
    loadWmsDataset('https://sh.dataspace.copernicus.eu/ogc/wms/213414a3-1fc8-47f4-8330-37682bebb388', 'Sentinel-2 L2A');
    loadWmsDataset('https://sh.dataspace.copernicus.eu/ogc/wms/a048bdd3-ffde-4de3-9c40-e5ea664c9a6a', 'Sentinel-3 OLCI L1');
    loadWmsDataset('https://sh.dataspace.copernicus.eu/ogc/wms/1db0bc0d-da44-46f9-b3b8-4032aaa0ea84', 'Sentinel-3 OLCI L2');
    loadWmsDataset('https://sh.dataspace.copernicus.eu/ogc/wms/da25aa31-86fb-45cf-9beb-adddbeb5bf09', 'Sentinel-3 SLSTR');
    loadWmsDataset('https://sh.dataspace.copernicus.eu/ogc/wms/7e258aba-7395-42a5-9cdf-1e2e359a7681', 'Sentinel-3 SYN L2');
    loadWmsDataset('https://sh.dataspace.copernicus.eu/ogc/wms/00278a81-04f0-44f5-aa8b-7bf9c177412e', 'Sentinel-5P (TROPOMI)');

    loadWmsDataset('https://dcm.itu.int/geoserver/dcm_prod/wms', 'ITU DCM');
    loadWmsDataset('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', 'NASA GIBS');

  }, [dispatch]);

  const _loadGeojsonData = useCallback(() => {
    const loadGeojsonDataset = (dataUrl, datasetName) => {
      const proxyUrl = 'https://cors-proxy.tacticalgator1.workers.dev/';
      const proxiedUrl = `${proxyUrl}?dataUrl=${encodeURIComponent(dataUrl)}`;

      log(`[${datasetName}] Starting to load dataset...`);

      fetch(proxiedUrl)
        .then(response => {
          if (!response.ok) {
            throw new Error(`[${datasetName}] CORS proxy fetch failed! status: ${response.status}`);
          }
          return response.json();
        })
        .then(geojson => {
          log(`[${datasetName}] Data received, dispatching addDataToMap...`);
          dispatch(
            addDataToMap({
              datasets: [
                {
                  info: {
                    label: datasetName,
                    id: datasetName
                  },
                  data: processGeojson(geojson)
                }
              ],
              options: {
                centerMap: false
              }
            })
          );
          log(`[${datasetName}] Dataset added to map.`);
        })
        .catch(error => {
          console.error(`[${datasetName}] Failed to load dataset:`, error);
        });
    };

    // Future datasets can be added by calling loadGeojsonDataset again here
   // loadGeojsonDataset('', '');
    loadGeojsonDataset('https://github.com/TacticalGator/daily-dataset/releases/download/daily-latest/seaports.json', 'Sea Ports');
    loadGeojsonDataset('https://github.com/TacticalGator/daily-dataset/releases/download/daily-latest/trx.json', 'Terrestrial Cables');
    loadGeojsonDataset('https://github.com/TacticalGator/daily-dataset/releases/download/daily-latest/cable-geo-enriched.json', 'Submarine Cables');

  }, [dispatch]);

  const _loadCsvData = useCallback(() => {
    const loadCsvDataset = (dataUrl, datasetName) => {
      const proxyUrl = 'https://cors-proxy.tacticalgator1.workers.dev/';
      const proxiedUrl = `${proxyUrl}?dataUrl=${encodeURIComponent(dataUrl)}`;

      log(`[${datasetName}] Starting to load dataset...`);

      fetch(proxiedUrl)
        .then(response => {
          if (!response.ok) {
            throw new Error(`[${datasetName}] CORS proxy fetch failed! status: ${response.status}`);
          }
          return response.text();
        })
        .then(csv => {
          log(`[${datasetName}] Data received, dispatching addDataToMap...`);
          dispatch(
            addDataToMap({
              datasets: [
                {
                  info: {
                    label: datasetName,
                    id: datasetName
                  },
                  data: processCsvData(csv)
                }
              ],
              options: {
                centerMap: false
              }
            })
          );
          log(`[${datasetName}] Dataset added to map.`);
        })
        .catch(error => {
          console.error(`[${datasetName}] Failed to load dataset:`, error);
        });
    };

    // Future datasets can be added by calling loadCsvDataset again here
    // loadCsvDataset('', '');
    loadCsvDataset('https://github.com/TacticalGator/daily-dataset/releases/download/daily-latest/airports.csv', 'Airports');

  }, [dispatch]);

  const _loadVectorTileData = useCallback(() => {
    const loadVectorTileDataset = async (tilesetUrl, datasetName) => {
      log(`[${datasetName}] Starting to load dataset...`);
      const isPmTiles = isPMTilesUrl(tilesetUrl);
      const remoteTileFormat = isPmTiles ? RemoteTileFormat.PMTILES : RemoteTileFormat.MVT;
      const metadataUrl = isPmTiles ? tilesetUrl : getMetaUrl(tilesetUrl);

      if (!metadataUrl) {
        console.error(`[${datasetName}] Could not determine metadata URL for`, tilesetUrl);
        return;
      }

      try {
        // 1. Fetch and parse metadata
        log(`[${datasetName}] Fetching metadata from: ${metadataUrl}`);
        const response = await fetch(metadataUrl);
        const metadata = await response.json();
        log(`[${datasetName}] Metadata received:`, metadata);

        if (typeof metadata.json === 'string') {
          log(`[${datasetName}] Parsing metadata.json string...`);
          metadata.json = JSON.parse(metadata.json);
        }

        // Workaround for Kepler.gl bug where it expects `metaJson` instead of `json`
        if (metadata.json && !metadata.metaJson) {
          log(`[${datasetName}] Applying workaround for metaJson property...`);
          metadata.metaJson = metadata.json;
        }

        const parsedMetadata = parseVectorMetadata(metadata, {
          tileUrl: metadataUrl
        });

        if (!parsedMetadata) {
          console.error(`[${datasetName}] Failed to parse metadata.`);
          return;
        }
        log(`[${datasetName}] Metadata parsed successfully.`);

        // 2. Infer fields if necessary
        if (parsedMetadata.fields.length === 0) {
          log(`[${datasetName}] Fields not found in metadata, attempting to infer from tile...`);
          try {
            await getFieldsFromTile({
              remoteTileFormat,
              tilesetUrl,
              metadataUrl,
              metadata: parsedMetadata
            });
            log(`[${datasetName}] Fields inferred successfully:`, parsedMetadata.fields);
          } catch (e) {
            console.error(`[${datasetName}] Error inferring fields from tile:`, e);
          }
        }

        if (parsedMetadata.fields.length === 0) {
          console.error(`[${datasetName}] Could not determine fields for this dataset. Cannot add to map.`);
          return;
        }

        // 3. Prepare dataset and layer configuration
        log(`[${datasetName}] Adding dataset to map...`);
        dispatch(updateVisData(
          {
            info: {
              id: datasetName,
              label: datasetName,
              type: 'vector-tile',
              format: 'rows'
            },
            data: {
              fields: parsedMetadata.fields,
              rows: []
            },
            metadata: {
              ...parsedMetadata,
              remoteTileFormat,
              tilesetDataUrl: tilesetUrl,
              tilesetMetadataUrl: metadataUrl,
            },
            supportedFilterTypes: [
              'real',
              'integer',
              'boolean'
            ],
            disableDataOperation: true
          },
          {
            autoCreateLayers: true,
            centerMap: true
          }
        ));


      } catch (error) {
        console.error(`[${datasetName}] Failed to load dataset:`, error);
      }
    }

    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/NASA%20FIRMS/{z}/{x}/{y}.pbf', 'Fire');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/USGS%20Earthquakes/{z}/{x}/{y}.pbf', 'Earthquake');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/Geoconfirmed/{z}/{x}/{y}.pbf', 'Geoconfirmed');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/ACLED/{z}/{x}/{y}.pbf', 'ACLED');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/UCDP/{z}/{x}/{y}.pbf', 'UCDP');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/OpenCellid/{z}/{x}/{y}.pbf', 'Cell Towers');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/Stanford%20RFI%20Jamming/{z}/{x}/{y}.pbf', 'GPS Jamming');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/Stanford%20RFI%20Jamming%20Event/{z}/{x}/{y}.pbf', 'GPS Jamming Event');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/Stanford%20RFI%20Spoofing%20Event/{z}/{x}/{y}.pbf', 'GPS Spoofing Event');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/Bellingcat%20Ukraine/{z}/{x}/{y}.pbf', 'Ukraine 2');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/Global%20Fishing%20Watch%20Encounters/{z}/{x}/{y}.pbf', 'AIS Encounter');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/Global%20Fishing%20Watch/{z}/{x}/{y}.pbf', 'AIS');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/Global%20Fishing%20Watch%20Offshore%20Infrastructures/{z}/{x}/{y}.pbf', 'Offshore Infrastructure');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/OSM%20Surveillance%20Camera/{z}/{x}/{y}.pbf', 'Surveillance Camera');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/APRS-IS/{z}/{x}/{y}.pbf', 'APRS-IS');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/ukrdailyupdate/{z}/{x}/{y}.pbf', 'Ukraine');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/MeshMap/{z}/{x}/{y}.pbf', 'Meshtastic');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/WRI%20Global%20Power%20Plants/{z}/{x}/{y}.pbf', 'Power Plants');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/ADSBexchange/{z}/{x}/{y}.pbf', 'Air Traffic');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/UNHCR%20PoC/{z}/{x}/{y}.pbf', 'UNHCR People of Concern');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/UNHCR%20Presence/{z}/{x}/{y}.pbf', 'UNHCR Presence');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/UNHCR%20Border%20Crossing/{z}/{x}/{y}.pbf', 'UNHCR Border Crossing');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/eyesonrussia/{z}/{x}/{y}.pbf', 'EyesOnRussia');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/GDELT/{z}/{x}/{y}.pbf', 'GDELT');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/GTTAC/{z}/{x}/{y}.pbf', 'GTTAC');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/PeeringDB/{z}/{x}/{y}.pbf', 'Data Centers');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/CrimeMapping/{z}/{x}/{y}.pbf', 'US Reported Crimes');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/Communitycrimemap/{z}/{x}/{y}.pbf', 'US Reported Crimes 2');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/rx-tx/{z}/{x}/{y}.pbf', 'SDR Stations');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/OSM%20Power%20Nodes/{z}/{x}/{y}.pbf', 'Power Nodes');
    loadVectorTileDataset('https://api.tacticalgator.net/api/kepler_tiles/OSM%20Power%20Grids/{z}/{x}/{y}.pbf', 'Power Grids');

  }, [dispatch]);

  const _loadInitialDatasets = useCallback(() => {
    _loadVectorTileData();
    _loadWmsData();
    _loadGeojsonData();
    _loadCsvData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dispatch,
    _loadVectorTileData,
    _loadWmsData,
    _loadGeojsonData,
    _loadCsvData
  ]);

  useEffect(() => {
    fetch('./keplergl_config.json')
      .then(response => {
        if (!response.ok) {
          // throw error to be caught by catch block
          throw new Error('Configuration file not found.');
        }
        return response.json();
      })
      .then(config => {
        const parsedConfig = KeplerGlSchema.parseSavedConfig(config);
        dispatch(receiveMapConfig(parsedConfig));
        setConfigLoaded(true);
      })
      .catch(error => {
        console.error('Error loading config:', error);
        setConfigLoaded(true); // still set to true to allow app to load datasets
      });
  }, [dispatch]);

  useEffect(() => {
    if (configLoaded) {

      // Load map using a custom
      if (query.mapUrl) {
        // TODO?: validate map url
        dispatch(loadRemoteMap({dataUrl: query.mapUrl}));
      }

      if (duckDbPluginEnabled && query.sql) {
        dispatch(toggleMapControl('sqlPanel', 0));
        dispatch(toggleModal(null));
      }

      _loadInitialDatasets();
    }
  }, [configLoaded, dispatch, id, provider, query, duckDbPluginEnabled, _loadInitialDatasets]);

  /**
   * Update map boundary when view state changes, used by ai-assistant to
   * get data from vector tiles when map boundary changes
   */
  const onViewStateChange = useCallback(
    viewState => {
      const viewport = new WebMercatorViewport(viewState);
      const nw = viewport.unproject([0, 0]);
      const se = viewport.unproject([viewport.width, viewport.height]);
      dispatch(setMapBoundary(nw, se));
    },
    [dispatch]
  );

  const _setStartScreenCapture = useCallback(
    flag => {
      dispatch(setStartScreenCapture(flag));
    },
    [dispatch]
  );

  const _setScreenCaptured = useCallback(
    screenshot => {
      dispatch(setScreenCaptured(screenshot));
    },
    [dispatch]
  );

  /*
  const _showBanner = useCallback(() => {
    toggleShowBanner(true);
  }, [toggleShowBanner]);
  */

  const hideBanner = useCallback(() => {
    toggleShowBanner(false);
  }, [toggleShowBanner]);

  const _disableBanner = useCallback(() => {
    hideBanner();
    Window.localStorage.setItem(BannerKey, 'true');
  }, [hideBanner]);

  return (
    <StyleSheetManager shouldForwardProp={shouldForwardProp}>
      <ThemeProvider theme={theme}>
        <GlobalStyle
        // this is to apply the same modal style as kepler.gl core
        // because styled-components doesn't always return a node
        // https://github.com/styled-components/styled-components/issues/617
        // ref={node => {
        //   node ? (this.root = node) : null;
        // }}
        >
          <ScreenshotWrapper
            startScreenCapture={props.demo.aiAssistant.screenshotToAsk.startScreenCapture}
            setScreenCaptured={_setScreenCaptured}
            setStartScreenCapture={_setStartScreenCapture}
            className="h-screen"
          >
            <Banner show={showBanner} height={BannerHeight} bgColor="#2E7CF6" onClose={hideBanner}>
              <Announcement onDisable={_disableBanner} />
            </Banner>
            <div style={CONTAINER_STYLE}>
              <PanelGroup direction="horizontal">
                <Panel defaultSize={isAiAssistantPanelOpen ? 70 : 100}>
                  <PanelGroup direction="vertical">
                    <Panel defaultSize={isSqlPanelOpen ? 60 : 100}>
                      <AutoSizer>
                        {({height, width}) => (
                          <KeplerGl
                            mapboxApiAccessToken={process.env.MAPBOX_ACCESS_TOKEN || CLOUD_PROVIDERS_CONFIGURATION.MAPBOX_TOKEN}
                            id="map"
                            getState={keplerGlGetState}
                            width={width}
                            height={height}
                            localeMessages={messages}
                            featureFlags={DEFAULT_FEATURE_FLAGS}
                            onViewStateChange={onViewStateChange}
                          />
                        )}
                      </AutoSizer>
                    </Panel>

                    {isSqlPanelOpen && (
                      <>
                        <StyledResizeHandle />
                        <Panel defaultSize={40} minSize={20}>
                          <SqlPanel initialSql={query.sql || ''} />
                        </Panel>
                      </>
                    )}
                  </PanelGroup>
                </Panel>
                {isAiAssistantPanelOpen && (
                  <>
                    <StyledVerticalResizeHandle />
                    <Panel defaultSize={30} minSize={20}>
                      <AiAssistantPanel />
                    </Panel>
                  </>
                )}
              </PanelGroup>
            </div>
          </ScreenshotWrapper>
        </GlobalStyle>
      </ThemeProvider>
    </StyleSheetManager>
  );
};

const mapStateToProps = state => state;
const dispatchToProps = dispatch => ({dispatch});

export default connect(mapStateToProps, dispatchToProps)(App);
