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
  loadSampleConfigurations,
  onExportFileSuccess,
  onLoadCloudMapSuccess
} from './actions';

import {
  loadCloudMap,
  addDataToMap,
  replaceDataInMap,
  toggleMapControl,
  toggleModal,
  updateVisData
} from '@kepler.gl/actions';
import {
  getMetaUrl,
  parseVectorMetadata,
  getFieldsFromTile
} from '@kepler.gl/table';
import {isPMTilesUrl} from '@kepler.gl/common-utils';
import {RemoteTileFormat} from '@kepler.gl/constants';
import {CLOUD_PROVIDERS} from './cloud-providers';
import {Panel, PanelGroup, PanelResizeHandle} from 'react-resizable-panels';

const KeplerGl = require('@kepler.gl/components').injectComponents([
  replaceLoadDataModal(),
  replaceMapControl(),
  replacePanelHeader()
]);

// Sample data
/* eslint-disable no-unused-vars */
import sampleTripData, {testCsvData, sampleTripDataConfig} from './data/sample-trip-data';
// import sampleGeojson from './data/sample-small-geojson';
// import sampleGeojsonPoints from './data/sample-geojson-points';
import sampleGeojsonConfig from './data/sample-geojson-config';
import sampleH3Data, {config as h3MapConfig} from './data/sample-hex-id-csv';
import sampleS2Data, {config as s2MapConfig, dataId as s2DataId} from './data/sample-s2-data';
import sampleAnimateTrip, {
  pointData,
  pointDataId,
  animateTripDataId,
  replacePointData,
  config as syncedTripConfig
} from './data/sample-animate-trip-data';
import sampleIconCsv from './data/sample-icon-csv';
import sampleGpsData from './data/sample-gps-data';
import sampleRowData, {config as rowDataConfig} from './data/sample-row-data';
import {processCsvData, processGeojson, processRowObject} from '@kepler.gl/processors';

/* eslint-enable no-unused-vars */

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

const App = props => {
  const [showBanner, toggleShowBanner] = useState(false);
  const {params: {id, provider} = {}, location: {query = {}} = {}} = props;
  const dispatch = useDispatch();

  // TODO find another way to check for existence of duckDb plugin
  const duckDbPluginEnabled = (getApplicationConfig().plugins || []).some(p => p.name === 'duckdb');

  const isSqlPanelOpen = useSelector(
    state => duckDbPluginEnabled && state?.demo?.keplerGl?.map?.uiState.mapControls.sqlPanel?.active
  );

  const isAiAssistantPanelOpen = useSelector(
    state => state?.demo?.keplerGl?.map?.uiState.mapControls.aiAssistant?.active
  );

  const prevQueryRef = useRef<number>(null);

  useEffect(() => {
    // if we pass an id as part of the url
    // we try to fetch along map configurations
    const cloudProvider = CLOUD_PROVIDERS.find(c => c.name === provider);
    if (cloudProvider) {
      // Prevent constant reloading after change of the location
      if (isEqual(prevQueryRef.current, {provider, id, query})) {
        return;
      }

      dispatch(
        loadCloudMap({
          loadParams: query,
          provider: cloudProvider,
          onSuccess: onLoadCloudMapSuccess
        })
      );
      prevQueryRef.current = {provider, id, query};
      return;
    }

    // Load sample using its id
    if (id) {
      dispatch(loadSampleConfigurations(id));
    }

    // Load map using a custom
    if (query.mapUrl) {
      // TODO?: validate map url
      dispatch(loadRemoteMap({dataUrl: query.mapUrl}));
    }

    if (duckDbPluginEnabled && query.sql) {
      dispatch(toggleMapControl('sqlPanel', 0));
      dispatch(toggleModal(null));
    }

    // delay zs to show the banner
    // if (!window.localStorage.getItem(BannerKey)) {
    //   window.setTimeout(_showBanner, 3000);
    // }
    // load sample data
    _loadSampleData();

    // Notifications

    // no dependencies, as this was part of componentDidMount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const _loadRowData = useCallback(() => {
    dispatch(
      addDataToMap({
        datasets: [
          {
            info: {
              label: 'Sample Visit Data',
              id: 'sample_visit_data'
            },
            data: processRowObject(sampleRowData)
          }
        ],
        config: rowDataConfig
      })
    );
  }, [dispatch]);

  const _loadVectorTileData = useCallback(() => {
    const loadVectorTileDataset = async (tilesetUrl, datasetName) => {
      console.log(`[${datasetName}] Starting to load dataset...`);
      const isPmTiles = isPMTilesUrl(tilesetUrl);
      const remoteTileFormat = isPmTiles ? RemoteTileFormat.PMTILES : RemoteTileFormat.MVT;
      const metadataUrl = isPmTiles ? tilesetUrl : getMetaUrl(tilesetUrl);

      if (!metadataUrl) {
        console.error(`[${datasetName}] Could not determine metadata URL for`, tilesetUrl);
        return;
      }

      try {
        // 1. Fetch and parse metadata
        console.log(`[${datasetName}] Fetching metadata from: ${metadataUrl}`);
        const response = await fetch(metadataUrl);
        const metadata = await response.json();
        console.log(`[${datasetName}] Metadata received:`, metadata);

        if (typeof metadata.json === 'string') {
          console.log(`[${datasetName}] Parsing metadata.json string...`);
          metadata.json = JSON.parse(metadata.json);
        }

        // Workaround for Kepler.gl bug where it expects `metaJson` instead of `json`
        if (metadata.json && !metadata.metaJson) {
          console.log(`[${datasetName}] Applying workaround for metaJson property...`);
          metadata.metaJson = metadata.json;
        }

        const parsedMetadata = parseVectorMetadata(metadata, {
          tileUrl: metadataUrl
        });

        if (!parsedMetadata) {
          console.error(`[${datasetName}] Failed to parse metadata.`);
          return;
        }
        console.log(`[${datasetName}] Metadata parsed successfully.`);

        // 2. Infer fields if necessary
        if (parsedMetadata.fields.length === 0) {
          console.log(`[${datasetName}] Fields not found in metadata, attempting to infer from tile...`);
          try {
            await getFieldsFromTile({
              remoteTileFormat,
              tilesetUrl,
              metadataUrl,
              metadata: parsedMetadata
            });
            console.log(`[${datasetName}] Fields inferred successfully:`, parsedMetadata.fields);
          } catch (e) {
            console.error(`[${datasetName}] Error inferring fields from tile:`, e);
          }
        }

        if (parsedMetadata.fields.length === 0) {
          console.error(`[${datasetName}] Could not determine fields for this dataset. Cannot add to map.`);
          return;
        }

        // 3. Prepare dataset and layer configuration
        console.log(`[${datasetName}] Adding dataset to map...`);
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

    loadVectorTileDataset('https://10.1.1.36/api/kepler_tiles/ukrdailyupdate/{z}/{x}/{y}.pbf', 'Ukraine');
    loadVectorTileDataset('https://10.1.1.36/api/kepler_tiles/MeshMap/{z}/{x}/{y}.pbf', 'Meshtastic');
    loadVectorTileDataset('https://10.1.1.36/api/kepler_tiles/WRI%20Global%20Power%20Plants/{z}/{x}/{y}.pbf', 'Power Plants');
  }, [dispatch]);

  const _loadSampleData = useCallback(() => {
    _loadVectorTileData();
    // _loadPointData();
    // _loadGeojsonData();
    // _loadTripGeoJson();
    // _loadIconData();
    // _loadH3HexagonData();
    // _loadS2Data();
    // _loadScenegraphLayer();
    // _loadGpsData();
    // _loadRowData();
    // _loadVectorTileData();
    // _loadSyncedFilterWTripLayer();
    // _replaceSyncedFilterWTripLayer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dispatch,
    _loadVectorTileData
  ]);

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
                            mapboxApiAccessToken={CLOUD_PROVIDERS_CONFIGURATION.MAPBOX_TOKEN}
                            id="map"
                            getState={keplerGlGetState}
                            width={width}
                            height={height}
                            cloudProviders={CLOUD_PROVIDERS}
                            localeMessages={messages}
                            onExportToCloudSuccess={onExportFileSuccess}
                            onLoadCloudMapSuccess={onLoadCloudMapSuccess}
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
