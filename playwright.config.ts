import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./browser-tests', timeout:60000, workers:1, retries:0,
  reporter:[['list'],['json',{outputFile:'test-results/browser-results.json'}]],
  projects:[
    {name:'chromium',use:{browserName:'chromium',launchOptions:{executablePath:process.env.NUSUMIDASE_CHROMIUM_EXECUTABLE,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}}},
    {name:'webkit',use:{browserName:'webkit',launchOptions:process.env.NUSUMIDASE_WEBKIT_EXECUTABLE?{executablePath:process.env.NUSUMIDASE_WEBKIT_EXECUTABLE}:undefined}}
  ],
  use:{baseURL:'http://127.0.0.1:4177',viewport:{width:393,height:852},hasTouch:true,deviceScaleFactor:1,screenshot:'only-on-failure',trace:'retain-on-failure'},
  webServer:{command:'npm run dev',url:'http://127.0.0.1:4177',reuseExistingServer:!process.env.CI,timeout:30000}
});
