"use client";
import React, { useMemo, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { RefreshCw, Info } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  LabelList,
  Cell,
} from "recharts";
import { PieChart, Pie, Cell as PieCell, Label } from "recharts";

// ------------------ Helpers & Constants ------------------
const L_PER_GAL = 3.785411784;
const ELECTROLYZER_EFFICIENCY_KWH_PER_KG_H2 = 43.4; // kWh per kg H2 for electrolyzer efficiency
const fmtCurrency = (n: number, symbol: string) => `${symbol}${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtNumber = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const deepClone = <T,>(obj: T): T => JSON.parse(JSON.stringify(obj));

// Internal base currency is USD; user can set FX for display.
const CURRENCIES = [
  { code: "USD", symbol: "$", defaultFx: 1 },
  { code: "GBP", symbol: "£", defaultFx: 0.76 },
  { code: "EUR", symbol: "€", defaultFx: 0.86 },
  { code: "CNY", symbol: "¥", defaultFx: 7.12 },
] as const;

const DEFAULTS = {
  fossilUSDPerGal: 2.3, // default jet fuel price for comparison
  policyCreditUSDPerGal: 0.0,
  densityKgPerL: 0.8, // Jet A/SAF typical
  feedstockUSDPerTon: 800, // Default feedstock cost (e.g., waste oils) - updated to more realistic 2024-2025 pricing
  hydrogenUSDPerKg: 6.5, // Default green hydrogen price - updated to reflect renewable H2 pricing for sustainable SAF
  catalystsChemicalsUSDPerGal: 0.12, // Default non-catalyst chemicals cost per gallon (solvents, acids, bases, etc.)
  omUSDPerGal: 0.35, // Default O&M cost per gallon - updated for realistic operations costs
  logisticsUSDPerGal: 0.30, // Default logistics cost per gallon - updated for realistic transport costs
};

// ------------------ Pathways & Shares (illustrative) ------------------
const PATHWAYS: Record<string, { description: string; baseShares: Record<string, number>; baseCIkgPerGal: number; ptlDefaults?: { gridKgPerKWh: number; kWhPerGal: number } }> = {
  HEFA: {
    description: "Hydroprocessed Esters & Fatty Acids (lipids → HEFA‑SPK)",
    baseShares: {
      "Feedstock (oils/lipids)": 58,
      Hydrogen: 12, // Increased to reflect green hydrogen premium pricing
      "Utilities (power/heat/water)": 6,
      "Chemicals": 2, // Reduced - non-catalyst chemicals only (solvents, acids, bases)
      "O&M": 7,
      "CAPEX & Financing": 11,
      Logistics: 4,
    },
    baseCIkgPerGal: 2.8, // Updated to reflect typical HEFA CI performance
  },
  ATJ: {
    description: "Alcohol‑to‑Jet (ethanol/isobutanol → ATJ‑SPK)",
    baseShares: {
      "Feedstock (alcohol)": 45,
      Utilities: 12,
      "Chemicals": 5, // Non-catalyst chemicals for fermentation/purification (nutrients, acids, bases)
      "O&M": 12,
      "CAPEX & Financing": 21, // Increased to maintain 100% total
      Logistics: 5,
    },
    baseCIkgPerGal: 4.2, // Updated to reflect typical ATJ CI with corn ethanol feedstock
  },
  "FT‑BTL": {
    description: "Fischer–Tropsch Biomass‑to‑Liquids",
    baseShares: {
      "Feedstock (biomass)": 30,
      Utilities: 18,
      "Chemicals": 3, // Non-catalyst chemicals for gasification/FT (process solvents, acids)
      "O&M": 16,
      "CAPEX & Financing": 28, // Increased to maintain 100% total
      Logistics: 5,
    },
    baseCIkgPerGal: 1.8, // Updated to reflect typical FT-BTL CI performance with sustainable biomass
  },
  "PtL (e‑fuels)": {
    description: "Power‑to‑Liquids (CO₂ + H₂ → e‑kerosene)",
    baseShares: {
      "Electricity – Electrolysis": 45,
      "Electricity – Synthesis/Compression": 10,
      "CO₂ Capture/Sourcing": 10,
      "H₂ Plant CAPEX & O&M": 10,
      "FT/Synfuels CAPEX & O&M": 15,
      "Chemicals": 2, // Non-catalyst chemicals for PtL (process solvents, cleaning agents)
      Logistics: 2,
      Other: 6, // Increased to maintain 100% total
    },
    baseCIkgPerGal: 1.5, // assuming low‑carbon power; adjustable below
    ptlDefaults: { gridKgPerKWh: 0.05, kWhPerGal: 15 },
  },
  "Novel PtL - Pure Electrolyzer": {
    description: "Novel synthesis technology: CO₂ + H₂ → SAF (H₂ from electrolysis, CO₂ from DAC/industrial)",
    baseShares: {
      "Electricity – Electrolysis": 45,
      "Electricity – Synthesis/Compression": 10,
      "CO₂ Capture/Sourcing": 10,
      "H₂ Plant CAPEX & O&M": 10,
      "FT/Synfuels CAPEX & O&M": 15,
      "Chemicals": 2, // Non-catalyst chemicals for PtL (process solvents, cleaning agents)
      Logistics: 2,
      Other: 6, // Increased to maintain 100% total
    },
    baseCIkgPerGal: 1.2, // Lower CI due to novel technology efficiency
    ptlDefaults: { gridKgPerKWh: 0.05, kWhPerGal: 15 },
  },
  "Novel PtL - Biomass": {
    description: "Novel synthesis technology: CO₂ + H₂ → SAF (H₂ from electrolysis, CO₂ from biomass gasification)",
    baseShares: {
      "Electricity – Electrolysis": 45,
      "Electricity – Synthesis/Compression": 10,
      "CO₂ Capture/Sourcing": 10,
      "H₂ Plant CAPEX & O&M": 10,
      "FT/Synfuels CAPEX & O&M": 15,
      "Chemicals": 2, // Non-catalyst chemicals for PtL (process solvents, cleaning agents)
      Logistics: 2,
      Other: 6, // Increased to maintain 100% total
    },
    baseCIkgPerGal: 0.8, // Very low CI due to biomass CO2 being carbon neutral
    ptlDefaults: { gridKgPerKWh: 0.05, kWhPerGal: 15 },
  },
  "Gasification‑FT + CCS": {
    description: "Biomass MSW gasification → FT with CO₂ capture & storage",
    baseShares: {
      "Feedstock (biomass/MSW)": 25,
      Utilities: 16,
      "Chemicals": 3, // Non-catalyst chemicals for gasification/FT/CCS (solvents, amine solutions)
      "O&M": 18,
      "CAPEX & Financing": 32, // Increased to maintain 100% total
      "CO₂ Transport & Storage": 4,
      Logistics: 2,
    },
    baseCIkgPerGal: 0.8, // Updated to reflect significant CI benefit from CCS and MSW utilization
  },
};

// Equipment costs by pathway
const PATHWAY_EQUIPMENT: Record<keyof typeof PATHWAYS, Record<string, number>> = {
  HEFA: {
    "Reactor & Hydrotreater": 45000000,
    "Distillation & Sep": 25000000,
    "Storage & Handling": 15000000,
    "Utilities (Power/Heat)": 20000000,
    "Control & Safety": 10000000,
  },
  ATJ: {
    "Fermentation Reactor": 35000000,
    "Distillation Unit": 28000000,
    "Dehydration & Conversion": 40000000,
    "Storage & Handling": 18000000,
    "Control & Safety": 12000000,
  },
  "FT‑BTL": {
    "Gasifier": 60000000,
    "Fischer‑Tropsch Reactor": 55000000,
    "Product Separation": 30000000,
    "Storage & Handling": 20000000,
    "Control & Safety": 15000000,
  },
  "PtL (e‑fuels)": {
    "Electrolyzer": 35000000,
    "CO₂ Capture Unit": 22000000,
    "Synfuels Reactor": 32000000,
    "Compression & Storage": 15000000,
    "Control & Safety": 6000000,
  },
  "Novel PtL - Pure Electrolyzer": {
    "Electrolyzer": 163136986,
    "Auxiliary Systems": 55000000,
    "Synfuels Reactor": 90000000,
    "Catalysts & Others": 22000000,
    "Control, Safety & Reserves": 49000000,
  },
  "Novel PtL - Biomass": {
    "Electrolyzer": 163136986,
    "Auxiliary Systems": 80000000,
    "Synfuels Reactor & Gassifier": 160000000,
    "Catalysts & Others": 24000000,
    "Control, Safety & Reserves": 70000000,
  },
  "Gasification‑FT + CCS": {
    "Gasifier": 70000000,
    "Fischer‑Tropsch Unit": 60000000,
    "CO₂ Capture & Compression": 45000000,
    "Storage & Sequestration": 25000000,
    "Control & Safety": 15000000,
  },
};

// Electricity requirements by pathway (MWh/year for 100 kton/year plant)
const PATHWAY_ELECTRICITY: Record<keyof typeof PATHWAYS, number> = {
  HEFA: 85000, // Updated: Significant electricity for hydroprocessing, distillation, compression, and utilities
  ATJ: 120000, // Updated: High electricity for fermentation temperature control, intensive distillation, and dehydration processes
  "FT‑BTL": 180000, // Updated: Very high power for gasification, FT synthesis, air separation unit, and compression systems
  "PtL (e‑fuels)": 450000, // Updated: Extremely high for electrolysis, CO2 capture, synthesis, and compression
  "Novel PtL - Pure Electrolyzer": 2087540, // Highest for Pure Electrolyzer setup
  "Novel PtL - Biomass": 963480, // High but slightly less than Pure Electrolyzer
  "Gasification‑FT + CCS": 280000, // Updated: Higher than basic FT due to CCS compression, CO2 transport pumps, and additional separation processes
};

// ------------------ Component ------------------
export default function SAFCostExplorer() {
  // Display / global options
  const [currency, setCurrency] = useState(CURRENCIES[0]);
  const [fxDisplayPerUSD, setFxDisplayPerUSD] = useState<number>(currency.defaultFx); // how many display‑currency per 1 USD
  const [unit, setUnit] = useState<"gal" | "L" | "kg" | "tonne">("gal");
  const [densityKgPerL, setDensityKgPerL] = useState<number>(DEFAULTS.densityKgPerL);

  // Pathway & presets
  const [pathway, setPathway] = useState<keyof typeof PATHWAYS>("Novel PtL - Pure Electrolyzer");
  const [preset, setPreset] = useState("Baseline");

  // Internal economic values in USD/gal
  const [fossilUSDPerGal, setFossilUSDPerGal] = useState<number>(DEFAULTS.fossilUSDPerGal);
  const [policyCreditUSDPerGal, setPolicyCreditUSDPerGal] = useState<number>(DEFAULTS.policyCreditUSDPerGal);
  const [blendPct, setBlendPct] = useState<number>(10);

  // Production cost inputs
  const [feedstockUSDPerTon, setFeedstockUSDPerTon] = useState<number>(DEFAULTS.feedstockUSDPerTon);
  const [feedstockTonsPerTonSAF, setFeedstockTonsPerTonSAF] = useState<number>(1.1); // Feedstock required per ton of SAF - updated for realistic conversion efficiency
  const [hydrogenUSDPerKg, setHydrogenUSDPerKg] = useState<number>(DEFAULTS.hydrogenUSDPerKg);
  const [hydrogenKgPerTonSAF, setHydrogenKgPerTonSAF] = useState<number>(0.5); // Hydrogen required per ton of SAF - updated for realistic H2 consumption
  // CO2 cost inputs for Novel PtL pathways
  const [co2USDPerTon, setCo2USDPerTon] = useState<number>(50); // Default CO2 cost for DAC or biomass gasification
  const [co2TonsPerTonSAF, setCo2TonsPerTonSAF] = useState<number>(3.5); // CO2 required per ton of SAF for novel synthesis
  const [catalystsChemicalsUSDPerGal, setCatalystsChemicalsUSDPerGal] = useState<number>(DEFAULTS.catalystsChemicalsUSDPerGal);
  const [omUSDPerGal, setOmUSDPerGal] = useState<number>(DEFAULTS.omUSDPerGal);
  const [logisticsUSDPerGal, setLogisticsUSDPerGal] = useState<number>(DEFAULTS.logisticsUSDPerGal);

  // Plant Economics / CAPEX
  const [plantSizeKTonYear, setPlantSizeKTonYear] = useState<number>(100); // 100k tons/year
  const [mwhPerYear, setMwhPerYear] = useState<number>(20000); // MWh/year
  const [electricityPriceUSDPerkWh, setElectricityPriceUSDPerkWh] = useState<number>(0.08); // $/kWh - updated to realistic industrial electricity pricing

  // CAPEX calculations
  // Equipment costs should scale with plant size (linear scaling)
  const [basePlantSizeKTonYear, setBasePlantSizeKTonYear] = useState<number>(100); // reference size changed to 100k tons/year
  const [equipScaleExponent, setEquipScaleExponent] = useState<number>(0.7); // default: sublinear scaling
  
  // Base electricity requirement at 100 kton/year
  const [baseMwhPerYear, setBaseMwhPerYear] = useState<number>(20000);
  
  // Update base electricity when pathway changes
  useEffect(() => {
    const pathwayElectricity = PATHWAY_ELECTRICITY[pathway];
    setBaseMwhPerYear(pathwayElectricity);
  }, [pathway]);

  // Update CO2 costs based on pathway
  useEffect(() => {
    if (pathway === "Novel PtL - Pure Electrolyzer") {
      setCo2USDPerTon(50); // Higher cost for DAC/industrial CO2
    } else if (pathway === "Novel PtL - Biomass") {
      setCo2USDPerTon(80); // Lower cost for biomass (represents biomass cost, not CO2 capture)
    }
  }, [pathway]);
  
  // Scale electricity linearly with plant size
  useEffect(() => {
    const scaledElectricity = (plantSizeKTonYear / basePlantSizeKTonYear) * baseMwhPerYear;
    setMwhPerYear(scaledElectricity);
  }, [plantSizeKTonYear, basePlantSizeKTonYear, baseMwhPerYear]);

  // Compute scaled equipment costs using scaling law: cost = base_cost * (size/base_size)^exponent
  const scaledEquipmentCosts = useMemo(() => {
    const scale = plantSizeKTonYear > 0 && basePlantSizeKTonYear > 0
      ? Math.pow(plantSizeKTonYear / basePlantSizeKTonYear, equipScaleExponent)
      : 1;
    const base = PATHWAY_EQUIPMENT[pathway] ?? {};
    
    const scaled = Object.fromEntries(
      Object.entries(base).map(([k, v]) => {
        // Special handling for Electrolyzer: scale based on electricity required
        if (k === "Electrolyzer") {
          // Calculate electrolyzer cost: $3M per 5MW, with 1.14 scaler
          // Convert annual kWh to MW: (kWh/year) / (8760 hours/year) / 1000 = MW
          const mw = (mwhPerYear * 1000) / 8760 / 1000; // Convert to MW
          const electrolyzerCost = (mw / 5) * 3000000 * 1.14;
          return [k, Math.round(electrolyzerCost)];
        }
        // All other equipment scales normally
        return [k, Math.round(v * scale)];
      })
    );
    
    return scaled;
  }, [plantSizeKTonYear, basePlantSizeKTonYear, equipScaleExponent, pathway, mwhPerYear]);

  // Use scaledEquipmentCosts for editing and display
  const [equipmentCosts, setEquipmentCosts] = useState<Record<string, number>>(() => deepClone(PATHWAY_EQUIPMENT["Novel PtL - Pure Electrolyzer"]));
  useEffect(() => {
    setEquipmentCosts(deepClone(scaledEquipmentCosts));
  }, [scaledEquipmentCosts]);

  const totalEquipmentCost = useMemo(
    () => Object.values(equipmentCosts).reduce((a, b) => a + b, 0),
    [equipmentCosts]
  );
  const annualSAFTons = plantSizeKTonYear * 1000;
  const galPerTon = 264.172; // 1 ton ≈ 264 gallons (at density 0.8 kg/L)
  const annualSAFGal = annualSAFTons * galPerTon;

  // Instead, use a simple straight-line amortization over a fixed period (e.g., 20 years)
  const CAPEX_YEARS = 20;
  const annualDebtService = useMemo(() => {
    return CAPEX_YEARS > 0 ? totalEquipmentCost / CAPEX_YEARS : 0;
  }, [totalEquipmentCost]);
  const capexPerGalUSD = annualSAFGal > 0 ? annualDebtService / annualSAFGal : 0;

  // Electricity cost calculation
  const annualElectricityCostUSD = useMemo(
    () => mwhPerYear * 1000 * electricityPriceUSDPerkWh, // Convert MWh to kWh and multiply by price per kWh
    [mwhPerYear, electricityPriceUSDPerkWh]
  );
  const electricityCostPerGalUSD = annualSAFGal > 0 ? annualElectricityCostUSD / annualSAFGal : 0;

  // LCA / GHG (kg CO2e/gal) - ADD THESE STATE VARIABLES HERE
  const [fossilCIkgPerGal, setFossilCIkgPerGal] = useState<number>(10.0);
  const [transportAddKgPerGal, setTransportAddKgPerGal] = useState<number>(0.0);
  const [userAdjKgPerGal, setUserAdjKgPerGal] = useState<number>(0.0);
  const [ptlGridKgPerKWh, setPtlGridKgPerKWh] = useState<number>(PATHWAYS["PtL (e‑fuels)"].ptlDefaults!.gridKgPerKWh);
  const [ptlKWhPerGal, setPtlKWhPerGal] = useState<number>(PATHWAYS["PtL (e‑fuels)"].ptlDefaults!.kWhPerGal);

  // Base CI for current pathway
  const baseCIkgPerGal = PATHWAYS[pathway]?.baseCIkgPerGal ?? 0;

  // Calculate production cost components per gallon
  const feedstockCostPerGalUSD = useMemo(() => {
    // For Novel PtL pathways, feedstock represents CO2 source cost
    if (pathway === "Novel PtL - Pure Electrolyzer" || pathway === "Novel PtL - Biomass") {
      return (co2USDPerTon * co2TonsPerTonSAF) / galPerTon;
    }
    // For traditional pathways, use normal feedstock calculation
    return (feedstockUSDPerTon * feedstockTonsPerTonSAF) / galPerTon;
  }, [pathway, feedstockUSDPerTon, feedstockTonsPerTonSAF, co2USDPerTon, co2TonsPerTonSAF, galPerTon]);

  const hydrogenCostPerGalUSD = useMemo(() => {
    // For PtL pathways, calculate H2 cost from electrolyzer efficiency and electricity price
    if (pathway === "Novel PtL - Pure Electrolyzer" || pathway === "Novel PtL - Biomass" || pathway === "PtL (e‑fuels)") {
      // H2 cost = electricity price * electrolyzer efficiency * H2 consumption per gallon
      const hydrogenKgPerGal = hydrogenKgPerTonSAF / galPerTon;
      return electricityPriceUSDPerkWh * ELECTROLYZER_EFFICIENCY_KWH_PER_KG_H2 * hydrogenKgPerGal;
    }
    // For traditional pathways, use direct hydrogen pricing
    return (hydrogenUSDPerKg * hydrogenKgPerTonSAF) / galPerTon;
  }, [pathway, hydrogenUSDPerKg, hydrogenKgPerTonSAF, galPerTon, electricityPriceUSDPerkWh]);

  // Total production cost per gallon (before credits)
  const totalProductionCostUSDPerGal = useMemo(() => {
    return (
      feedstockCostPerGalUSD +
      hydrogenCostPerGalUSD +
      electricityCostPerGalUSD +
      catalystsChemicalsUSDPerGal +
      omUSDPerGal +
      logisticsUSDPerGal
    );
  }, [
    feedstockCostPerGalUSD,
    hydrogenCostPerGalUSD,
    electricityCostPerGalUSD,
    catalystsChemicalsUSDPerGal,
    omUSDPerGal,
    logisticsUSDPerGal,
  ]);

  // Total after credits
  const totalAfterCreditsUSDPerGal = useMemo(
    () => Math.max(totalProductionCostUSDPerGal - policyCreditUSDPerGal, 0),
    [totalProductionCostUSDPerGal, policyCreditUSDPerGal]
  );

  // Shares & multipliers - now recalculated from actual costs
  const { rows, totalBeforeUSDPerGal, totalAfterUSDPerGal } = useMemo(() => {
    // Determine feedstock component name based on pathway
    let feedstockComponentName = "Feedstock";
    if (pathway === "Novel PtL - Pure Electrolyzer") {
      feedstockComponentName = "CO₂ (DAC/Industrial)";
    } else if (pathway === "Novel PtL - Biomass") {
      feedstockComponentName = "CO₂ (Biomass gasification)";
    }

    const components = [
      { component: feedstockComponentName, usdPerGal: feedstockCostPerGalUSD },
      { component: "Hydrogen", usdPerGal: hydrogenCostPerGalUSD },
      { component: "Electricity", usdPerGal: electricityCostPerGalUSD },
      { component: "Chemicals", usdPerGal: catalystsChemicalsUSDPerGal },
      { component: "O&M", usdPerGal: omUSDPerGal },
      { component: "Logistics", usdPerGal: logisticsUSDPerGal },
    ];

    const total = components.reduce((sum, c) => sum + c.usdPerGal, 0);
    const detailed = components
      .map((c) => ({ ...c, pct: total > 0 ? c.usdPerGal / total : 0 }))
      .sort((a, b) => b.pct - a.pct);

    return {
      rows: detailed,
      totalBeforeUSDPerGal: total,
      totalAfterUSDPerGal: Math.max(total - policyCreditUSDPerGal, 0),
    };
  }, [
    pathway,
    feedstockCostPerGalUSD,
    hydrogenCostPerGalUSD,
    electricityCostPerGalUSD,
    catalystsChemicalsUSDPerGal,
    omUSDPerGal,
    logisticsUSDPerGal,
    policyCreditUSDPerGal,
  ]);

  const blendedUSDPerGal = useMemo(
    () => (blendPct / 100) * totalAfterUSDPerGal + (1 - blendPct / 100) * fossilUSDPerGal,
    [blendPct, totalAfterUSDPerGal, fossilUSDPerGal]
  );

  const blendedPremiumPct = useMemo(
    () => fossilUSDPerGal > 0 ? ((blendedUSDPerGal - fossilUSDPerGal) / fossilUSDPerGal) * 100 : 0,
    [blendedUSDPerGal, fossilUSDPerGal]
  );

  // ------------------ Presets ------------------
  const applyPreset = (name: string) => {
    setPreset(name);
    if (name === "Baseline") {
      setFeedstockUSDPerTon(DEFAULTS.feedstockUSDPerTon);
      setCo2USDPerTon(150); // Default CO2 cost for Novel PtL pathways
      setHydrogenUSDPerKg(DEFAULTS.hydrogenUSDPerKg);
      setCatalystsChemicalsUSDPerGal(DEFAULTS.catalystsChemicalsUSDPerGal);
      setOmUSDPerGal(DEFAULTS.omUSDPerGal);
      setLogisticsUSDPerGal(DEFAULTS.logisticsUSDPerGal);
      setPolicyCreditUSDPerGal(DEFAULTS.policyCreditUSDPerGal);
      setElectricityPriceUSDPerkWh(0.08);
    } else if (name === "Cheap feedstock") {
      setFeedstockUSDPerTon(DEFAULTS.feedstockUSDPerTon * 0.75);
      setCo2USDPerTon(120); // Cheaper CO2 for Novel PtL pathways
    } else if (name === "High CAPEX") {
      // Equipment costs will reflect in CAPEX automatically - no change needed
    } else if (name === "High power price") {
      setElectricityPriceUSDPerkWh(0.14);
    } else if (name === "Generous credits") {
      setPolicyCreditUSDPerGal(1.25);
    }
  };

  // ------------------ Conversions ------------------
  const unitFactorToGal = useMemo(() => {
    // price_per_gal = price_per_unit * factor
    const kgPerGal = densityKgPerL * L_PER_GAL;
    switch (unit) {
      case "gal":
        return 1;
      case "L":
        return L_PER_GAL;
      case "kg":
        return kgPerGal;
      case "tonne":
        return kgPerGal / 1000;
      default:
        return 1;
    }
  }, [unit, densityKgPerL]);

  const toDisplay = (usdPerGal: number) => (usdPerGal * fxDisplayPerUSD) / unitFactorToGal;
  const fromDisplay = (displayPerUnit: number) => (displayPerUnit / fxDisplayPerUSD) * unitFactorToGal; // → USD/gal

  // Keep FX consistent with currency switch
  useEffect(() => {
    setFxDisplayPerUSD(currency.defaultFx);
  }, [currency]);

  // ------------------ Core math ------------------
  // Remove old sharesSum calculation that references customShares
  // const sharesSum = useMemo(() => Object.values(customShares).reduce((a, b) => a + Number(b || 0), 0), [customShares]);

  // ------------------ LCA / Abatement ------------------
  const ptlAddKgPerGal = pathway === "PtL (e‑fuels)" ? ptlGridKgPerKWh * ptlKWhPerGal : 0;
  const safCIkgPerGal = Math.max(0, baseCIkgPerGal + transportAddKgPerGal + ptlAddKgPerGal + userAdjKgPerGal);
  const abatementKgPerGal = Math.max(0, fossilCIkgPerGal - safCIkgPerGal);
  const safPremiumUSDPerGal = totalAfterUSDPerGal - fossilUSDPerGal;
  const abatementCostPerTCO2_USD = abatementKgPerGal > 0 ? safPremiumUSDPerGal / (abatementKgPerGal / 1000) : null;

  // ------------------ Charts ------------------
  const chartData = useMemo(() => rows.map((r) => ({ name: r.component, percent: r.pct * 100 })), [rows]);
  const COLORS = ["#2563eb", "#22c55e", "#f59e0b", "#ef4444", "#14b8a6", "#8b5cf6", "#e11d48", "#64748b", "#0ea5e9"];

  // Equipment cost chart data
  const equipmentChartData = useMemo(
    () => Object.entries(equipmentCosts).map(([name, cost]) => ({ name, value: cost })),
    [equipmentCosts]
  );

  // ------------------ DEV SELF‑TESTS ------------------
  useEffect(() => {
    const tests: { name: string; pass: boolean; msg?: string }[] = [];

    // Test 1: conversion round‑trip
    const x = 12.34;
    const rt = fromDisplay(toDisplay(x));
    tests.push({ name: "Round‑trip conversion", pass: Math.abs(rt - x) < 1e-9, msg: `${rt}` });

    // Test 2: abatement non‑negative
    tests.push({ name: "Abatement non‑negative", pass: abatementKgPerGal >= 0 });

    // Test 3: total production cost matches sum of components
    const calculatedTotal = feedstockCostPerGalUSD + hydrogenCostPerGalUSD + electricityCostPerGalUSD + 
                           catalystsChemicalsUSDPerGal + omUSDPerGal + logisticsUSDPerGal;
    tests.push({ 
      name: "Production cost sum matches", 
      pass: Math.abs(totalBeforeUSDPerGal - calculatedTotal) < 0.01,
      msg: `${totalBeforeUSDPerGal.toFixed(2)} vs ${calculatedTotal.toFixed(2)}`
    });

    // eslint-disable-next-line no-console
    console.groupCollapsed("SAF Cost Explorer – self tests");
    for (const t of tests) {
      // eslint-disable-next-line no-console
      console[t.pass ? "log" : "error"](`${t.pass ? "✔" : "✘"} ${t.name}${t.msg ? ": " + t.msg : ""}`);
    }
    // eslint-disable-next-line no-console
    console.groupEnd();
  }, [
    fxDisplayPerUSD, 
    unit, 
    densityKgPerL, 
    abatementKgPerGal,
    totalBeforeUSDPerGal,
    feedstockCostPerGalUSD,
    hydrogenCostPerGalUSD,
    electricityCostPerGalUSD,
    catalystsChemicalsUSDPerGal,
    omUSDPerGal,
    capexPerGalUSD,
    logisticsUSDPerGal,
  ]);

  // ------------------ UI ------------------
  return (
    <TooltipProvider>
      <div className="min-h-screen w-full bg-gradient-to-b from-slate-50 to-white text-slate-900">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mx-auto max-w-7xl px-4 py-6 sm:py-10"
        >
          <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">SAF Cost Explorer</h1>
              <p className="mt-1 text-sm text-slate-600">
                Adjust SAF premium, costs, policies, units, and LCA to see precise % and {currency.code}/ {unit} contributions at each step.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => applyPreset("Baseline")} className="gap-2">
                <RefreshCw className="h-4 w-4" /> Reset
              </Button>
            </div>
          </header>

          {/* CAPEX & Plant Economics Panel - MOVED TO TOP */}
          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>CAPEX & Plant Economics</CardTitle>
                <div className="rounded-full bg-blue-100 px-3 py-1 w-fit mt-2">
                  <span className="text-xs font-semibold text-blue-800">{pathway}</span>
                </div>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {/* Left: Plant inputs and scaling controls */}
                <div className="space-y-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Plant Size (k tons SAF/year)</label>
                    <Input type="number" step="1" value={plantSizeKTonYear} onChange={(e) => setPlantSizeKTonYear(Math.max(1, Number(e.target.value)))} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Electricity Required/year (MWh)</label>
                    <Input type="number" step="1" value={mwhPerYear} onChange={(e) => {
                      setMwhPerYear(Math.max(0, Number(e.target.value)));
                      // Update base when manually edited
                      setBaseMwhPerYear((Math.max(0, Number(e.target.value)) / plantSizeKTonYear) * basePlantSizeKTonYear);
                    }} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium flex items-center gap-1">
                      Equipment Scaling Exponent
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-4 w-4 text-slate-400" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs">
                          <div>
                            <b>Scaling law:</b> cost = base × (size/base)<sup>exponent</sup><br />
                            1.0 = linear, 0.6–0.8 = typical for process plants.
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </label>
                    <Slider value={[equipScaleExponent]} min={0.5} max={1} step={0.01} onValueChange={([v]) => setEquipScaleExponent(v)} />
                    <div className="text-xs text-slate-600">Current: {equipScaleExponent.toFixed(2)}</div>
                    <div className="text-xs text-slate-400 mt-1">
                      Base costs: {basePlantSizeKTonYear} kton/year. Typical: 0.6–0.8.
                    </div>
                  </div>
                </div>

                {/* Middle: Equipment costs editable */}
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-slate-700">Equipment Costs (USD, scaled)</p>
                  {Object.entries(equipmentCosts).map(([k, v]) => (
                    <div key={k}>
                      <span className="text-xs text-slate-600 block mb-1">{k}</span>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={fmtNumber(v)}
                        onChange={(e) => {
                          const numVal = parseInt(e.target.value.replace(/,/g, ""), 10);
                          if (!isNaN(numVal)) {
                            setEquipmentCosts({ ...equipmentCosts, [k]: Math.max(0, numVal) });
                          }
                        }}
                        className="h-8 text-sm tabular-nums"
                        placeholder="0"
                        disabled={k === "Electrolyzer"}
                        readOnly={k === "Electrolyzer"}
                      />
                    </div>
                  ))}
                </div>

                {/* Right: Summary */}
                <div className="space-y-3 rounded-2xl border p-3 flex flex-col items-center">
                  <div className="flex items-center justify-between w-full">
                    <div className="text-sm text-slate-600">Total Equipment Cost</div>
                    <div className="text-lg font-semibold tabular-nums">${fmtNumber(totalEquipmentCost)}</div>
                  </div>
                  <div className="flex items-center justify-between w-full">
                    <div className="text-sm text-slate-600">Annual Debt Service</div>
                    <div className="text-lg font-semibold tabular-nums">${fmtNumber(annualDebtService)}</div>
                  </div>
                  <div className="flex items-center justify-between w-full">
                    <div className="text-sm text-slate-600">Annual Electricity Cost</div>
                    <div className="text-lg font-semibold tabular-nums">${fmtNumber(annualElectricityCostUSD)}</div>
                  </div>
                  <div className="flex items-center justify-between w-full">
                    <div className="text-sm font-medium">CAPEX/Gallon/year</div>
                    <div className="text-xl font-bold tabular-nums">${capexPerGalUSD.toFixed(2)}</div>
                  </div>
                  <div className="flex items-center justify-between w-full">
                    <div className="text-sm font-medium">Electricity/Gallon/year</div>
                    <div className="text-xl font-bold tabular-nums">${electricityCostPerGalUSD.toFixed(2)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Equipment Cost Breakdown Donut Chart Section */}
          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Equipment Cost Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="flex justify-center items-center">
                <div className="w-full min-w-[400px] h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={equipmentChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={110}
                        paddingAngle={2}
                        cornerRadius={8}
                        dataKey="value"
                        label={({ name, percent }: any) => `${name}: ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {equipmentChartData.map((_, i) => (
                          <PieCell key={`eq-${i}`} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <RTooltip formatter={(value: number) => `$${fmtNumber(value as number)}`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Controls */}
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle>Production Cost Inputs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Pathway</label>
                    <Select value={pathway} onValueChange={(v) => setPathway(v as keyof typeof PATHWAYS)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.keys(PATHWAYS).map((k) => (
                          <SelectItem key={k} value={k}>
                            {k}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-slate-500">{PATHWAYS[pathway].description}</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Preset</label>
                    <Select value={preset} onValueChange={(v) => applyPreset(v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["Baseline", "Cheap feedstock", "High CAPEX", "High power price", "Generous credits"].map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Units</label>
                    <Select value={unit} onValueChange={(v) => setUnit(v as typeof unit)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[
                          { v: "gal", l: "per gallon" },
                          { v: "L", l: "per liter" },
                          { v: "kg", l: "per kg" },
                          { v: "tonne", l: "per tonne" },
                        ].map((u) => (
                          <SelectItem key={u.v} value={u.v}>
                            {u.l}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Electricity Price (USD/kWh)</label>
                    <Input type="number" step="0.001" value={electricityPriceUSDPerkWh} onChange={(e) => setElectricityPriceUSDPerkWh(Math.max(0, Number(e.target.value)))} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      {pathway === "Novel PtL - Pure Electrolyzer" ? "CO₂ Price (USD/ton)" :
                       pathway === "Novel PtL - Biomass" ? "Biomass Price (USD/ton)" : 
                       "Feedstock Price (USD/ton)"}
                    </label>
                    <Input 
                      type="number" 
                      step="1" 
                      value={pathway === "Novel PtL - Pure Electrolyzer" || pathway === "Novel PtL - Biomass" ? co2USDPerTon : feedstockUSDPerTon} 
                      onChange={(e) => {
                        if (pathway === "Novel PtL - Pure Electrolyzer" || pathway === "Novel PtL - Biomass") {
                          setCo2USDPerTon(Math.max(0, Number(e.target.value)));
                        } else {
                          setFeedstockUSDPerTon(Math.max(0, Number(e.target.value)));
                        }
                      }} 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      {pathway === "Novel PtL - Pure Electrolyzer" || pathway === "Novel PtL - Biomass" ? "CO₂ Ratio (tons/ton SAF)" : "Feedstock Ratio (tons/ton SAF)"}
                    </label>
                    <Input 
                      type="number" 
                      step="0.1" 
                      value={pathway === "Novel PtL - Pure Electrolyzer" || pathway === "Novel PtL - Biomass" ? co2TonsPerTonSAF : feedstockTonsPerTonSAF} 
                      onChange={(e) => {
                        if (pathway === "Novel PtL - Pure Electrolyzer" || pathway === "Novel PtL - Biomass") {
                          setCo2TonsPerTonSAF(Math.max(0, Number(e.target.value)));
                        } else {
                          setFeedstockTonsPerTonSAF(Math.max(0, Number(e.target.value)));
                        }
                      }} 
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Only show hydrogen price input for non-PtL pathways */}
                  {pathway !== "Novel PtL - Pure Electrolyzer" && pathway !== "Novel PtL - Biomass" && pathway !== "PtL (e‑fuels)" ? (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Hydrogen (USD/kg)</label>
                      <Input type="number" step="0.1" value={hydrogenUSDPerKg} onChange={(e) => setHydrogenUSDPerKg(Math.max(0, Number(e.target.value)))} />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">H₂ Cost (calculated from electricity)</label>
                      <Input 
                        type="number" 
                        step="0.1" 
                        value={(electricityPriceUSDPerkWh * ELECTROLYZER_EFFICIENCY_KWH_PER_KG_H2).toFixed(2)} 
                        readOnly 
                        className="bg-slate-50 text-slate-600"
                      />
                      <p className="text-xs text-slate-500">
                        Auto-calculated: ${electricityPriceUSDPerkWh}/kWh × {ELECTROLYZER_EFFICIENCY_KWH_PER_KG_H2} kWh/kg H₂
                      </p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">H₂ (kg/ton SAF)</label>
                    <Input type="number" step="1" value={hydrogenKgPerTonSAF} onChange={(e) => setHydrogenKgPerTonSAF(Math.max(0, Number(e.target.value)))} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Chemicals ({currency.code}/{unit})</label>
                    <Input type="number" step="0.01" value={toDisplay(catalystsChemicalsUSDPerGal)} onChange={(e) => setCatalystsChemicalsUSDPerGal(Math.max(0, fromDisplay(Number(e.target.value))))} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">O&M ({currency.code}/{unit})</label>
                    <Input type="number" step="0.01" value={toDisplay(omUSDPerGal)} onChange={(e) => setOmUSDPerGal(Math.max(0, fromDisplay(Number(e.target.value))))} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Logistics ({currency.code}/{unit})</label>
                    <Input type="number" step="0.01" value={toDisplay(logisticsUSDPerGal)} onChange={(e) => setLogisticsUSDPerGal(Math.max(0, fromDisplay(Number(e.target.value))))} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Policy credit ({currency.code}/{unit})</label>
                    <Input type="number" step="0.01" value={toDisplay(policyCreditUSDPerGal)} onChange={(e) => setPolicyCreditUSDPerGal(Math.max(0, fromDisplay(Number(e.target.value))))} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Blend ratio (SAF in blend)</label>
                    <span className="text-sm tabular-nums">{blendPct}%</span>
                  </div>
                  <Slider value={[blendPct]} min={0} max={100} step={1} onValueChange={([v]) => setBlendPct(v)} />
                </div>
              </CardContent>
            </Card>

            {/* Charts & KPIs */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Cost Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                <div className="lg:col-span-3 h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical" margin={{ top: 10, right: 20, bottom: 10, left: 100 }}>
                      <XAxis type="number" domain={[0, 100]} hide />
                      <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 12 }} />
                      <RTooltip formatter={(value: number) => [`${Number(value).toFixed(1)}%`, "Share"]} />
                      <Bar dataKey="percent" radius={[6, 6, 6, 6]}>
                        {chartData.map((_, i) => (
                          <Cell key={`c-${i}`} fill={COLORS[i % COLORS.length]} />
                        ))}
                        <LabelList dataKey="percent" position="right" formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="lg:col-span-2 grid gap-3">
                  <div className="rounded-2xl border p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-slate-600">Total (pre‑credit)</div>
                      <div className="text-lg font-semibold tabular-nums">{fmtCurrency(toDisplay(totalBeforeUSDPerGal), currency.symbol)} /{unit}</div>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="text-sm text-slate-600">Policy credit</div>
                      <div className="text-lg font-semibold tabular-nums">−{fmtCurrency(toDisplay(policyCreditUSDPerGal), currency.symbol)} /{unit}</div>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="text-sm text-slate-600">Total (post‑credit)</div>
                      <div className="text-xl font-bold tabular-nums">{fmtCurrency(toDisplay(totalAfterUSDPerGal), currency.symbol)} /{unit}</div>
                    </div>
                  </div>

                  <div className="rounded-2xl border p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-slate-600">Fossil Jet (reference)</div>
                      <div className="text-lg font-semibold tabular-nums">{fmtCurrency(toDisplay(fossilUSDPerGal), currency.symbol)} /{unit}</div>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="text-sm text-slate-600">Blended cost ({blendPct}% SAF)</div>
                      <div className="text-lg font-semibold tabular-nums">{fmtCurrency(toDisplay(blendedUSDPerGal), currency.symbol)} /{unit}</div>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="text-sm text-slate-600">Blended premium vs Fossil</div>
                      <div className={`text-xl font-bold tabular-nums ${blendedPremiumPct >= 0 ? "text-rose-600" : "text-emerald-600"}`}>
                        {blendedPremiumPct >= 0 ? "+" : ""}
                        {blendedPremiumPct.toFixed(1)}%
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border p-3 text-xs text-slate-500 leading-relaxed">
                    Figures are illustrative defaults. Credits are applied after the component breakdown and are not reallocated into component shares.
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Details table */}
          <div className="mt-4 grid grid-cols-1 gap-4">
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Production Cost Details (pre‑credit)</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full table-auto text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="p-2 text-left">Component</th>
                      <th className="p-2 text-right">Share</th>
                      <th className="p-2 text-right">{currency.code}/{unit}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.component} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                        <td className="p-2">{r.component}</td>
                        <td className="p-2 text-right tabular-nums">{fmtPct(r.pct)}</td>
                        <td className="p-2 text-right tabular-nums">{fmtCurrency(toDisplay(r.usdPerGal), currency.symbol)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="p-2 font-medium">Total Production Cost (pre‑credit)</td>
                      <td className="p-2 text-right tabular-nums font-medium">100.0%</td>
                      <td className="p-2 text-right tabular-nums font-medium">{fmtCurrency(toDisplay(totalBeforeUSDPerGal), currency.symbol)}</td>
                    </tr>
                    <tr>
                      <td className="p-2 text-emerald-700">Less: Policy credit</td>
                      <td className="p-2 text-right tabular-nums">—</td>
                      <td className="p-2 text-right tabular-nums">−{fmtCurrency(toDisplay(policyCreditUSDPerGal), currency.symbol)}</td>
                    </tr>
                    <tr>
                      <td className="p-2 font-semibold">Total Production Cost (post‑credit)</td>
                      <td className="p-2 text-right tabular-nums font-semibold">—</td>
                      <td className="p-2 text-right tabular-nums font-semibold">{fmtCurrency(toDisplay(totalAfterUSDPerGal), currency.symbol)}</td>
                    </tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>

          {/* LCA / GHG Panel */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
             <Card className="lg:col-span-3">
               <CardHeader>
                 <CardTitle>LCA / GHG & Abatement</CardTitle>
               </CardHeader>
               <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
                 <div className="space-y-3">
                   <div className="space-y-2">
                     <label className="text-sm font-medium">Fossil Jet CI (kg CO₂e/gal)</label>
                     <Input type="number" step="0.01" value={fossilCIkgPerGal} onChange={(e) => setFossilCIkgPerGal(Math.max(0, Number(e.target.value)))} />
                   </div>
                   <div className="space-y-2">
                     <label className="text-sm font-medium">Base SAF CI for {pathway} (kg CO₂e/gal)</label>
                     <Input type="number" step="0.01" value={baseCIkgPerGal} readOnly />
                     <p className="text-xs text-slate-500">Preset, pathway‑specific baseline. Use adjustments to reflect your data.</p>
                   </div>
                 </div>

                 <div className="space-y-3">
                   {pathway === "PtL (e‑fuels)" && (
                     <div className="space-y-2">
                       <label className="text-sm font-medium flex items-center gap-1">
                         PtL electricity (grid & use)
                         <Tooltip>
                           <TooltipTrigger asChild>
                             <Info className="h-4 w-4 text-slate-400" />
                           </TooltipTrigger>
                           <TooltipContent className="max-w-xs text-xs">Adds grid CO₂ = grid‑intensity × kWh/gal to the pathway base CI.</TooltipContent>
                         </Tooltip>
                       </label>
                       <div className="grid grid-cols-2 gap-2">
                         <div>
                           <div className="text-xs text-slate-600 mb-1">Grid intensity (kg/kWh)</div>
                           <Input type="number" step="0.001" value={ptlGridKgPerKWh} onChange={(e) => setPtlGridKgPerKWh(Math.max(0, Number(e.target.value)))} />
                         </div>
                         <div>
                           <div className="text-xs text-slate-600 mb-1">Electricity use (kWh/gal)</div>
                           <Input type="number" step="0.1" value={ptlKWhPerGal} onChange={(e) => setPtlKWhPerGal(Math.max(0, Number(e.target.value)))} />
                         </div>
                       </div>
                       <div className="text-xs text-slate-600">
                         PtL electricity add‑on: <span className="tabular-nums font-medium">{(ptlGridKgPerKWh * ptlKWhPerGal).toFixed(2)}</span> kg CO₂e/gal
                       </div>
                     </div>
                   )}

                   <div className="space-y-2">
                     <label className="text-sm font-medium">Transport add‑on (kg CO₂e/gal)</label>
                     <Input type="number" step="0.01" value={transportAddKgPerGal} onChange={(e) => setTransportAddKgPerGal(Math.max(0, Number(e.target.value)))} />
                   </div>
                   <div className="space-y-2">
                     <label className="text-sm font-medium">User adjustment (± kg CO₂e/gal)</label>
                     <Input type="number" step="0.01" value={userAdjKgPerGal} onChange={(e) => setUserAdjKgPerGal(Number(e.target.value))} />
                   </div>
                 </div>

                 <div className="space-y-3 rounded-2xl border p-3">
                   <div className="flex items-center justify-between">
                     <div className="text-sm text-slate-600">SAF CI (computed)</div>
                     <div className="text-lg font-semibold tabular-nums">{safCIkgPerGal.toFixed(2)} kg CO₂e/gal</div>
                   </div>
                   <div className="flex items-center justify-between">
                     <div className="text-sm text-slate-600">Abatement vs fossil</div>
                     <div className="text-lg font-semibold tabular-nums">{abatementKgPerGal.toFixed(2)} kg CO₂e/gal</div>
                   </div>
                   <div className="flex items-center justify-between">
                     <div className="text-sm text-slate-600">Abatement cost</div>
                     <div className="text-xl font-bold tabular-nums">{abatementCostPerTCO2_USD === null ? "—" : `${fmtCurrency(abatementCostPerTCO2_USD * fxDisplayPerUSD, currency.symbol)} /tCO₂e`}</div>
                   </div>
                   <p className="mt-1 text-xs text-slate-500">Calculated as premium / (abatement/1000). Use sliders to reflect your LCA data.</p>
                 </div>
               </CardContent>
             </Card>
           </div>

          <footer className="mt-8 text-center text-xs text-slate-500">
            Built for scenario testing. Import your CSV to override shares; export to share results.
          </footer>
        </motion.div>
      </div>
    </TooltipProvider>
  );
}
